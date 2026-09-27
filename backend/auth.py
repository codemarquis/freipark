import os

from fastapi import Header, HTTPException
from jose import JWTError, jwt

JWT_SECRET = os.environ["JWT_SECRET"]


async def get_current_user_id(authorization: str = Header(...)) -> str:
    """Verifies a self-hosted GoTrue access token and returns the caller's
    user id (the JWT's `sub` claim).

    Self-hosted GoTrue signs with a shared HS256 secret (JWT_SECRET), not
    the asymmetric JWKS scheme SPEC-infra.md's "Verifying Supabase JWTs
    (Future)" section speculated for managed Supabase — verified against
    the actual deployment, not assumed.
    """
    token = authorization.removeprefix("Bearer ").strip()
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=["HS256"], audience="authenticated")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return claims["sub"]
