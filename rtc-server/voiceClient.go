package main

import (
	"net"

	"github.com/pion/webrtc/v4"
)

type VoiceClient struct {
	UserID string
	SSRC uint32
	Address *net.UDPAddr //only for udp clients
	LocalTrack *webrtc.TrackLocalStaticRTP
	SecretKey [32]byte
	IsWebRTC bool //lil helper
	CurrentRoom *VoiceRoom
	Speaking bool
	CurrentRTCClient *RTCClient
}

func CreateVoiceClient(UserID string, SSRC uint32, isWebRTC bool, rtcClient *RTCClient, addr *net.UDPAddr, track *webrtc.TrackLocalStaticRTP) *VoiceClient {
	return &VoiceClient{
        UserID:     UserID,
        SSRC:       SSRC,
        IsWebRTC:   isWebRTC,
        Address:    addr,
        LocalTrack: track,
		CurrentRTCClient: rtcClient,
		Speaking: false,
    }
}

func (vc *VoiceClient) LeaveRoom() {
	if vc.CurrentRoom == nil {
        return
    }

	vc.CurrentRoom.RemoveClient(vc.SSRC)
	vc.CurrentRoom = nil
}

func (vc *VoiceClient) JoinRoom(roomID string) {
	if vc.CurrentRoom != nil {
        vc.LeaveRoom()
    }

	room := GetOrCreateVoiceRoom(roomID)

	vc.CurrentRoom = room

	room.AddClient(vc)
}