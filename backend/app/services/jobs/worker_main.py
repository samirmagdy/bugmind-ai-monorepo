from app.core.logging import configure_logging
from app.services.jobs.queue import run_worker


if __name__ == "__main__":
    configure_logging()
    run_worker()
