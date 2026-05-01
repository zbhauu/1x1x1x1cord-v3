package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/joho/godotenv"
	"github.com/pion/sdp/v3"
	"github.com/pion/webrtc/v4"
)

const Port = 3240

var (
    pendingSessions = make(map[string]SyncData)
    sessionMu sync.RWMutex
	clients = make(map[string]*RTCClient)
	clientsMu sync.RWMutex
	RTC_SECRET_KEY string
	IP string
)

func VerifyConnection(serverId string, userId string, sessionId string, token string) (SyncData, bool) {
	sessionMu.RLock()
    defer sessionMu.RUnlock()

    for k, v := range pendingSessions {
        if k == token {
            return v, true
        }
    }

    return SyncData{}, false
}

func AddClient(client *RTCClient) {
    clientsMu.Lock()
    defer clientsMu.Unlock()
    clients[client.UserID] = client
}

func RemoveClient(userID string) {
    clientsMu.Lock()
    defer clientsMu.Unlock()
    delete(clients, userID)
}

func ReconstructSDP(fragment string) (string, error) {
    sd := &sdp.SessionDescription{
        Version: 0,
        Origin: sdp.Origin{
            Username:       "-",
            SessionID:      0,
            SessionVersion: 0,
            NetworkType:    "IN",
            AddressType:    "IP4",
            UnicastAddress: "127.0.0.1",
        },
        SessionName: "-",
        TimeDescriptions: []sdp.TimeDescription{
            {Timing: sdp.Timing{StartTime: 0, StopTime: 0}},
        },
    }

	var audioFormats []string
	var videoFormats []string

	lines := strings.Split(fragment, "\n")
    for _, line := range lines {
        line = strings.TrimSpace(line)
        if !strings.HasPrefix(line, "a=rtpmap:") {
            continue
        }

        parts := strings.Split(strings.TrimPrefix(line, "a=rtpmap:"), " ")
        if len(parts) < 2 { continue }
        
        payloadID := parts[0]
        codecInfo := strings.ToLower(parts[1])

        if strings.Contains(codecInfo, "opus") {
            audioFormats = append(audioFormats, payloadID)
        } else if strings.Contains(codecInfo, "vp8") || strings.Contains(codecInfo, "h264") || strings.Contains(codecInfo, "rtx") {
            videoFormats = append(videoFormats, payloadID)
        }
    }

	if len(audioFormats) == 0 { audioFormats = []string{"111"} }
    if len(videoFormats) == 0 { videoFormats = []string{"96"} }

	audioMedia := &sdp.MediaDescription{
        MediaName: sdp.MediaName{
            Media: "audio", Port: sdp.RangedPort{Value: 9},
            Protos: []string{"UDP", "TLS", "RTP", "SAVPF"},
            Formats: audioFormats,
        },
        Attributes: []sdp.Attribute{{Key: "setup", Value: "actpass"}, {Key: "mid", Value: "audio"}},
    }

    videoMedia := &sdp.MediaDescription{
        MediaName: sdp.MediaName{
            Media: "video", Port: sdp.RangedPort{Value: 9},
            Protos: []string{"UDP", "TLS", "RTP", "SAVPF"},
            Formats: videoFormats,
        },
        Attributes: []sdp.Attribute{{Key: "setup", Value: "actpass"}, {Key: "mid", Value: "video"}},
    }

   for _, line := range lines {
        line = strings.TrimSpace(line)
        if line == "" || !strings.HasPrefix(line, "a=") { continue }
        attrRaw := strings.TrimPrefix(line, "a=")
        parts := strings.SplitN(attrRaw, ":", 2)
        attr := sdp.Attribute{Key: parts[0]}
        if len(parts) > 1 { attr.Value = parts[1] }

        audioMedia.Attributes = append(audioMedia.Attributes, attr)
        videoMedia.Attributes = append(videoMedia.Attributes, attr)
    }

    sd.MediaDescriptions = append(sd.MediaDescriptions, audioMedia, videoMedia)

    marshaled, err := sd.Marshal()
    return string(marshaled), err
}

func BroadcastToClients(serverId string, payload interface{}) {
	clientsMu.RLock();
	defer clientsMu.RUnlock();

	data, err := json.Marshal(payload)
	if err != nil {
		return
	}

	for _, client := range clients {
		if client.ServerID == serverId {
			err := client.Socket.Write(context.Background(), websocket.MessageText, data)
			if err != nil {
				fmt.Printf("Failed to broadcast packet to %s: %v\n", client.UserID, err)
			}
		}
	}
}

func SubscribeUserToTrack(subscriber *RTCClient, remoteTrack *webrtc.TrackRemote) {
	if subscriber.PeerConnection == nil {
		return
	}

    localTrack, err := webrtc.NewTrackLocalStaticRTP(
        remoteTrack.Codec().RTPCodecCapability, 
        remoteTrack.ID(), 
        remoteTrack.StreamID(),
    )
    if err != nil {
        fmt.Printf("Failed to create local track: %v\n", err)
        return
    }

    sender, err := subscriber.PeerConnection.AddTrack(localTrack)
    if err != nil {
        fmt.Printf("Failed to add track to PC: %v\n", err)
        return
    }

    subscriber.mu.Lock()

    if subscriber.SubscribedTracks == nil {
        subscriber.SubscribedTracks = make(map[string]*webrtc.RTPSender)
    }

    subscriber.SubscribedTracks[remoteTrack.ID()] = sender
    subscriber.mu.Unlock()

	fmt.Printf("Subscribed to track from %s\n", subscriber.UserID)

    rtpBuf := make([]byte, 1500)
    for {
        n, _, err := remoteTrack.Read(rtpBuf)
        if err != nil {
            return 
        }

        if _, err = localTrack.Write(rtpBuf[:n]); err != nil {
            return 
        }
    }
}

func CheckAndForwardExistingTracks(serverId string, userId string) {
	clientsMu.RLock();
	defer clientsMu.RUnlock();

	contextClient, ok := clients[userId]
    if !ok {
        return
    }

	for _, otherClient := range clients {
        if otherClient.UserID != userId && otherClient.ServerID == serverId {
            if otherClient.AudioTrack != nil {
                go SubscribeUserToTrack(contextClient, otherClient.AudioTrack)
            }
        }
    }
}

func handleSignaling(writer http.ResponseWriter, request *http.Request) {
	c, err := websocket.Accept(writer, request, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})

	if err != nil {
		fmt.Println("Failed to accept client: ", err)
		return
	}

	defer c.Close(websocket.StatusInternalError, "Connection Closed")

	var currentUserID string

    defer func() {
        if currentUserID != "" {
			clientsMu.Lock()
			client, exists := clients[currentUserID]
			if exists {
				client.Close()
				delete(clients, currentUserID)
			}
			clientsMu.Unlock()
			fmt.Printf("User %s disconnected.\n", currentUserID)
		}
    }()

	ctx := request.Context()

	wsjson.Write(ctx, c, map[string]interface{}{
        "op": OpHello,
        "d": map[string]interface{}{
            "heartbeat_interval": 41250,
        },
    })

	for {
        var msg struct {
            Op int             `json:"op"`
            D  json.RawMessage `json:"d"`
        }

        err := wsjson.Read(ctx, c, &msg)
        if err != nil {
            fmt.Println("Read error:", err)
            return
        }

		switch msg.Op {
			
			case int(OpIdentify):
				var d Identify 
				if err := json.Unmarshal(msg.D, &d); err != nil {
					fmt.Println("Unmarshal error:", err)
					continue
				}

				sessionData, ok := VerifySession(d.Token)

				if sessionData.ServerID != d.ServerID && sessionData.UserID != d.UserID && sessionData.SessionID != d.SessionID {
					fmt.Printf("User %s tried to force their way in with an invalid matching session ID & Token from the gateway server. They have been blocked.\n", d.UserID)
					c.Close(4004, "Authentication failed")
					return
				}

				if !ok {
					fmt.Printf("User %s tried to force their way in with an invalid matching session ID & Token from the gateway server. They have been blocked.\n", d.UserID)
					c.Close(4004, "Authentication failed")
					return
				}

				fmt.Printf("User %s verified for server %s\n", d.UserID, d.ServerID)

				client := NewRTCClient(d.UserID, d.ServerID, d.SessionID, d.Token, 1234, d.Video, c)
				currentUserID = client.UserID

				AddClient(client)

				fmt.Printf("User %s added to active clients.\n", client.UserID)

				wsjson.Write(ctx, c, map[string]interface{}{
					"op": OpReady,
					"d": map[string]interface{}{
						"ssrc":         1234,
						"port": Port,
						"modes": []string{
							"xsalsa20_poly1305",
							"plain",
						},
						"heartbeat_interval" : 41250,
					},
				})

				CheckAndForwardExistingTracks(client.ServerID, client.UserID)
			case int(OpHeartbeat):
				wsjson.Write(ctx, c, map[string]interface{}{
					"op": OpHeartbeatAck,
					"d":  msg.D,
				})
			case int(OpSelectProtocol):
				var data struct {
					Protocol string `json:"protocol"`
					Data     string `json:"data"`
					SDP      string `json:"sdp"`
				}

				if err := json.Unmarshal(msg.D, &data); err != nil {
					fmt.Println("SelectProtocol Unmarshal error:", err)
					continue
				}

				fmt.Println("Received Select Protocol for", data.Protocol)

				if data.Protocol != "webrtc" {
					c.Close(4012, "Unknown protocol") // currently only webrtc is supported in this version of rtc-server
					return
				}

				sdpFragment := data.SDP
				if sdpFragment == "" {
					sdpFragment = data.Data
				}

				clients[currentUserID].SetupPC(sdpFragment)
		}
	}
}

type SyncData struct {
	UserID string `json:"user_id"`
	ServerID  string `json:"server_id"`
	SessionID string `json:"session_id"`
	Token string `json:"token"`
}

func AddSession(data SyncData) {
    sessionMu.Lock()
    defer sessionMu.Unlock()
    pendingSessions[data.Token] = data
}

func VerifySession(token string) (SyncData, bool) {
    sessionMu.Lock()
    defer sessionMu.Unlock()
    
    data, exists := pendingSessions[token]

    return data, exists
}

func handleSync(writer http.ResponseWriter, request* http.Request) {
	if RTC_SECRET_KEY == "" || request.Header.Get("Authorization") != "Bearer " + RTC_SECRET_KEY {
		http.Error(writer, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var data SyncData
    if err := json.NewDecoder(request.Body).Decode(&data); err != nil {
        return
    }

    AddSession(data)
    writer.WriteHeader(http.StatusOK)
	fmt.Printf("Authorized new user: %s to join vc in %s with %s\n", data.UserID, data.ServerID, data.Token)
}

func GetOutboundIP() net.IP {
    conn, err := net.Dial("udp", "8.8.8.8:80")
    if err != nil {
        log.Fatal(err)
    }
    defer conn.Close()

    localAddr := conn.LocalAddr().(*net.UDPAddr)

    return localAddr.IP
}

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Fatal("Error loading .env file")
	}

	RTC_SECRET_KEY = os.Getenv("RTC_SECRET_KEY");
	IP := GetOutboundIP()
	http.HandleFunc("/", handleSignaling);
	http.HandleFunc("/internal/sync", handleSync)
	fmt.Println("[OLDCORD] RTC Server v2.0 is up on " + IP.To16().String() + ":" + strconv.Itoa(Port))
	log.Fatal(http.ListenAndServe(":" + strconv.Itoa(Port), nil))
}