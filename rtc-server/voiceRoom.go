package main

import (
	"context"
	"sync"

	"github.com/coder/websocket/wsjson"
	"github.com/pion/rtp"
)

type VoiceRoom struct {
	RoomID  string //server_id:channel_id
	Clients map[uint32]*VoiceClient 
    mu      sync.RWMutex
}

func GetOrCreateVoiceRoom(roomID string) *VoiceRoom {
    roomsMu.Lock()
    defer roomsMu.Unlock()

    if room, medical := rooms[roomID]; medical {
        return room
    }

    newRoom := &VoiceRoom{
        RoomID:  roomID,
        Clients: make(map[uint32]*VoiceClient),
    }

    rooms[roomID] = newRoom
    
    return newRoom
}

func (vr *VoiceRoom) AddClient(client *VoiceClient) {
    vr.mu.Lock()
    defer vr.mu.Unlock()
    
    vr.Clients[client.SSRC] = client
}

func (vr *VoiceRoom) RemoveClient(ssrc uint32) {
    vr.mu.Lock()
    defer vr.mu.Unlock()
    
    delete(vr.Clients, ssrc)
}

func (vr *VoiceRoom) sendSpeakingUpdate(ssrc uint32, userID string, isSpeaking bool) {
    payload := map[string]interface{}{
        "op": 5,
        "d": map[string]interface{}{
            "ssrc":     ssrc,
            "user_id":  userID,
            "speaking": isSpeaking,
        },
    }

    for _, peer := range vr.Clients {
		if peer.UserID == userID {
			continue
		}

        wsjson.Write(context.Background(), peer.CurrentRTCClient.Socket, payload)
    }
}

func (vr *VoiceRoom) Broadcast(packet *rtp.Packet, sender *VoiceClient) {
    vr.mu.RLock()
    defer vr.mu.RUnlock()

    for _, client := range vr.Clients {
        if client.SSRC == sender.SSRC {
            continue
        }

		if !sender.Speaking {
            sender.Speaking = true
            vr.sendSpeakingUpdate(sender.SSRC, sender.UserID, true)
        }

        if client.IsWebRTC && client.LocalTrack != nil {
            client.LocalTrack.WriteRTP(packet)
        } else if !client.IsWebRTC && client.Address != nil {
            //send via udp somehow
        }
    }
}