import secrets
from fastapi import Header, HTTPException, status
from .config import settings


async def require_api_key(x_api_key: str = Header(default=None)) -> None:
    """Validate X-Api-Key header when API_KEY is configured.

    When api_key is empty the backend operates in open mode (no auth required),
    preserving backward compatibility for existing deployments. Set API_KEY in
    the environment or config.yml to enable authentication.
    """
    if not settings.api_key:
        return
    if x_api_key is None or not secrets.compare_digest(x_api_key, settings.api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
            headers={"WWW-Authenticate": "ApiKey"},
        )
