FROM ghcr.io/berriai/litellm:main-latest

COPY litellm-config.yaml /app/litellm-config.yaml

CMD ["--config", "/app/litellm-config.yaml", "--host", "0.0.0.0", "--port", "4000"]
