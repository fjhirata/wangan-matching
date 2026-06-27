FROM python:3.12-slim
WORKDIR /app
COPY . .
# 依存ライブラリなし（Python標準ライブラリのみ）
ENV PORT=8000
ENV REFRESH_HOURS=12
EXPOSE 8000
CMD ["python3", "backend/server.py"]
