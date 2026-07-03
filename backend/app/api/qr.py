"""QR generation — one scannable tag per asset code."""
import io

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter()


@router.get("/{asset_code}.png")
def asset_qr(asset_code: str):
    """PNG QR encoding the asset code; printed and stuck on the asset."""
    import qrcode  # lazy import; pip install qrcode[pil]

    img = qrcode.make(asset_code)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")
