FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      inkscape \
      python3 \
      python3-pip \
      python3-wxgtk4.0 \
      potrace \
      xvfb \
      xauth \
      curl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG INKSTITCH_VERSION=3.2.2
RUN curl -fsSL "https://github.com/inkstitch/inkstitch/archive/refs/tags/v${INKSTITCH_VERSION}.tar.gz" \
      | tar -xz -C /opt \
    && mv "/opt/inkstitch-${INKSTITCH_VERSION}" /opt/inkstitch

ARG INKEX_SHA=1792934a09046fdef8aab20d05aad9c47f825bf5
RUN curl -fsSL "https://gitlab.com/inkscape/extensions/-/archive/${INKEX_SHA}/extensions-${INKEX_SHA}.tar.gz" \
      | tar -xz -C /opt \
    && mv "/opt/extensions-${INKEX_SHA}" /opt/inkex_src

ARG PYEMBROIDERY_SHA=13e94dbfc4a3b7de93ce2e771bf8ccf22e3551cb
RUN curl -fsSL "https://github.com/inkstitch/pystitch/archive/${PYEMBROIDERY_SHA}.tar.gz" \
      | tar -xz -C /opt \
    && mv "/opt/pystitch-${PYEMBROIDERY_SHA}" /opt/pyembroidery_src

RUN sed -E '/^\.\/pyembroidery/d; /^pytest/d; /^types-/d; /^wxPython/d; /^inkex @ git/d' \
      /opt/inkstitch/requirements.txt > /tmp/inkstitch-req.txt \
    && pip install --break-system-packages --no-cache-dir \
        cssselect \
        tinycss2 \
        pyparsing \
        Pillow \
        scour \
        packaging \
        pyserial \
        -r /tmp/inkstitch-req.txt

WORKDIR /app

# Paths are relative to the build context. Railway builds with the repo root
# as context (no per-service Root Directory field on our plan), so prefix with
# `worker/`. Locally, build from repo root too:
#   docker build -t embroidery-worker -f worker/Dockerfile .
COPY worker/requirements.txt .
RUN pip install --break-system-packages --no-cache-dir -r requirements.txt

COPY worker/main.py .

ENV PYTHONPATH=/opt/inkex_src:/opt/pyembroidery_src:/opt/inkstitch
ENV INKSTITCH_OFFLINE_SCRIPT=true
ENV INKSTITCH_PATH=/opt/inkstitch/inkstitch.py

ENV PORT=8080
EXPOSE 8080

# WORKERS = number of OS worker processes to fork. Override via the runtime env
# (Railway env panel, `docker run -e WORKERS=N`). Defaults to 4 if unset. Each
# worker saturates one core; match WORKERS to available CPUs on the host. Safe
# because each /trace and /convert call uses its own tempdir — no shared state.
# --limit-concurrency 1 makes each process reject (HTTP 503) any request that
# arrives while it's already busy. Combined with --workers N, that caps total
# in-flight pipeline jobs at N and gives callers an immediate "try later" instead
# of silently queuing behind a 10-minute inkstitch run.
# --host :: binds IPv6 unspecified. Linux dual-stack lets this accept IPv4 too,
# so `docker run -p 8080:8080` local dev still works. Railway's private network
# is IPv6-only (`*.railway.internal` resolves to AAAA-only), so binding to
# IPv4-only `0.0.0.0` makes the worker silently unreachable from sibling services.
#
# NOTE: --limit-concurrency was removed. It counts connections at the HTTP
# layer and was returning bogus 503s on idle workers (0 CPU, first request).
# Concurrency/rejection is done in main.py via an explicit semaphore so we
# can tell "actually processing" apart from "connection opened". Overload
# rejection still ends up as 429 at our Next.js surface.
CMD ["sh", "-c", "uvicorn main:app --host :: --port ${PORT} --workers ${WORKERS:-4}"]
