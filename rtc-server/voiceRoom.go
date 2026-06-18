package main

import (
	"sync"
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