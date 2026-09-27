import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user_id

router = APIRouter()

# Prefer an internal, same-docker-network URL for server-to-server admin
# calls: from inside the OVH box, requests to the public SUPABASE_URL
# hairpin back through the box's own public IP/Caddy, which can time out
# (confirmed: httpx.ConnectTimeout in production). Falls back to the
# public SUPABASE_URL for local dev, where there's no internal network.
SUPABASE_ADMIN_URL = os.environ.get("SUPABASE_INTERNAL_URL") or os.environ["SUPABASE_URL"]
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


class DeleteAccountResponse(BaseModel):
    status: str


@router.delete("/account", response_model=DeleteAccountResponse)
async def delete_account(user_id: str = Depends(get_current_user_id)) -> DeleteAccountResponse:
    """Deletes the caller's own account. Requires the service-role key to
    call GoTrue's admin API — never exposed to the frontend; the caller's
    identity comes only from their own verified access token.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.delete(
            f"{SUPABASE_ADMIN_URL}/auth/v1/admin/users/{user_id}",
            headers={
                "apikey": SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            },
        )

    if resp.status_code not in (200, 204):
        raise HTTPException(status_code=502, detail="Failed to delete account")

    return DeleteAccountResponse(status="deleted")
