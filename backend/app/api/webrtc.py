from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..remote.webrtc_peer import WebRTCPeer

router = APIRouter(prefix="/api/webrtc", tags=["webrtc"])


def _peer(request: Request) -> WebRTCPeer:
    peer: WebRTCPeer | None = getattr(request.app.state, "webrtc_peer", None)
    if peer is None:
        raise HTTPException(status_code=503, detail="WebRTC peer não inicializado")
    return peer


# ── POST /api/webrtc/offer ────────────────────────────────────────────────────

class SDPOffer(BaseModel):
    sdp: str
    type: str


class SDPAnswer(BaseModel):
    sdp: str
    type: str


@router.post("/offer", response_model=SDPAnswer)
async def webrtc_offer(body: SDPOffer, request: Request) -> SDPAnswer:
    """Recebe SDP offer do browser e devolve o SDP answer."""
    peer = _peer(request)
    try:
        answer = await peer.handle_offer(body.sdp, body.type)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return SDPAnswer(**answer)


# ── POST /api/webrtc/close ────────────────────────────────────────────────────

@router.post("/close")
async def webrtc_close(request: Request) -> dict:
    """Encerra a peer connection activa."""
    peer = _peer(request)
    try:
        await peer.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"ok": True}
