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

COPY requirements.txt .
RUN pip install --break-system-packages --no-cache-dir -r requirements.txt

COPY main.py .

ENV PYTHONPATH=/opt/inkex_src:/opt/pyembroidery_src:/opt/inkstitch
ENV INKSTITCH_OFFLINE_SCRIPT=true
ENV INKSTITCH_PATH=/opt/inkstitch/inkstitch.py

ENV PORT=8080
EXPOSE 8080

# WORKERS = number of OS worker processes to fork. Override via the runtime env
# (Railway env panel, `docker run -e WORKERS=N`). Defaults to 4 if unset. Each
# worker saturates one core; match WORKERS to available CPUs on the host. Safe
# because each /trace and /convert call uses its own tempdir — no shared state.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers ${WORKERS:-4}"]
