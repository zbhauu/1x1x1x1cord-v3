package main

import "encoding/json"

type OpCode int

const (
	OpIdentify OpCode = iota // 0
	OpSelectProtocol // 1
	OpReady // 2
	OpHeartbeat // 3
	OpAnswer // 4
	OpFiller1 // 5
	OpHeartbeatAck // 6
	OpHello = 8
	OpDisconnect = 13
)

type Identify struct {
	ServerID  string `json:"server_id"`
	UserID    string `json:"user_id"`
	SessionID string `json:"session_id"`
	Token     string `json:"token"`
	Video     bool   `json:"video"`
}

type Codec struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Priority int32 `json:"priority"`
	PayloadType int32 `json:"payload_type"`
	RtxPayloadType int32 `json:"rtx_payload_type"`
}

type SyncData struct {
	UserID string `json:"user_id"`
	ServerID  string `json:"server_id"`
	SessionID string `json:"session_id"`
	Token string `json:"token"`
}

type SelectProtocol struct {
	Protocol string `json:"protocol"`
	Data json.RawMessage `json:"data"`
	SDP string `json:"sdp,omitempty"`
	Codecs []Codec `json:"codecs"`
}

type UDPData struct {
    Address string `json:"address"`
    Port    uint16 `json:"port"`
    Mode    string `json:"mode"`
}

type Ready struct {
	SSRC 	uint32 	`json:"ssrc"`
	IP 		string 	`json:"ip"`
	Port	int		`json:"port"`
	Modes 	[]string `json:"modes"`
	HeartbeatInterval	int		`json:"heartbeat_interval"`
}