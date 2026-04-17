from slowapi import Limiter
from slowapi.util import get_remote_address

# Initialize limiter
# We use get_remote_address as the default identifier (IP-based)
limiter = Limiter(key_func=get_remote_address)
