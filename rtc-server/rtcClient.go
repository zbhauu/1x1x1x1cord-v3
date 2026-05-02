package main

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/pion/webrtc/v4"
)

type RTCClient struct {
	ServerID  string
	UserID    string
	SessionID string
	Token     string
	SSRC      uint32
	Video     bool
	SelfMute  bool
	SelfDeaf  bool
	PeerConnection *webrtc.PeerConnection
	AudioTrack *webrtc.TrackRemote
	VideoTrack *webrtc.TrackRemote
	SubscribedTracks map[string]*webrtc.RTPSender
	Socket          *websocket.Conn
    mu             sync.Mutex
}

func NewRTCClient(userID string, serverID string, sessionId string, token string, ssrc uint32, video bool, socket *websocket.Conn) *RTCClient {
	return &RTCClient{
		ServerID:  serverID,
		UserID:    userID,
		SessionID: sessionId,
		Token:     token,
		Video:     video,
		Socket: socket,
		SubscribedTracks: make(map[string]*webrtc.RTPSender),
	}
}

func (c *RTCClient) Close() {
	if c.PeerConnection != nil {
		c.PeerConnection.Close()
	}
}

func (c *RTCClient) MakeAnswer(Port int32, IP string, UsernameFragment string, Password string, fingerprint string) string {
	fingerprint = strings.ToUpper(strings.TrimSpace(fingerprint))

	sdpAnswer := fmt.Sprintf(
		"m=audio %d ICE/SDP\n"+
		"c=IN IP4 %s\n"+
		"a=rtcp:%d\n"+
		"a=ice-ufrag:%s\n"+
		"a=ice-pwd:%s\n"+
		"a=fingerprint:sha-256 %s\n"+
		"a=candidate:1 1 UDP 1076302079 %s %d typ host\n",
		Port, 
		IP, 
		Port, 
		UsernameFragment, 
		Password, 
		fingerprint,
		IP,
		Port,
	)

	return sdpAnswer
}

func (c *RTCClient) SetupPC(sdpFragment string) {
	if c.PeerConnection != nil {
		return;
	}

	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}},
	})

	if err != nil { 
		fmt.Println("failed to make new pc "); 
		return 
	}

	fullOffer, err := ReconstructSDP(sdpFragment)

	if err != nil {
		fmt.Println("Failed to reconstruct sdp fragment into full SDP!")
		return
	}

	fmt.Println(fullOffer)

	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: fullOffer}); err != nil {
		fmt.Printf("Pion Error Detail: %v\n", err)
		return
	}

	answer, _ := pc.CreateAnswer(nil)
	if err := pc.SetLocalDescription(answer); err != nil {
		fmt.Println("failed to set local description")
		return 
	}

	sctp := pc.SCTP().Transport()
	dtlsParams, _ := sctp.GetLocalParameters()
	iceParams, _  := sctp.ICETransport().GetLocalParameters()

	fingerprint := dtlsParams.Fingerprints[0].Value

	sdpAnswer := c.MakeAnswer(Port, IP, iceParams.UsernameFragment, iceParams.Password, fingerprint)
	
	c.PeerConnection = pc

	outputTrack, _ := webrtc.NewTrackLocalStaticRTP(
        webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus}, 
        "audio", 
        "pion",
    )

	vc := CreateVoiceClient(c.UserID, c.SSRC, true, c, nil, outputTrack)
	vc.JoinRoom(c.ServerID) //move to channel

	fmt.Println("I'm up waiting")

	pc.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		fmt.Printf("New track: %s\n", remoteTrack.Kind().String())

		if remoteTrack.Kind() == webrtc.RTPCodecTypeAudio {
			c.AudioTrack = remoteTrack
			clientsMu.RLock()

			go func() {
                for {
                    rtpPacket, _, err := remoteTrack.ReadRTP()

                    if err != nil { return }

                    if vc.CurrentRoom != nil {
                        vc.CurrentRoom.Broadcast(rtpPacket, vc)
                    }
                }
            }()

			clientsMu.RUnlock()
		}
	})

	wsjson.Write(context.Background(), c.Socket, map[string]interface{}{
		"op": OpAnswer,
		"d": map[string]interface{}{
			"sdp":         sdpAnswer,
			"audio_codec": "opus",
			"video_codec": "VP8",
		},
	})
}