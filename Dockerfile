FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# 公网请在运行时通过环境变量覆盖：TRUST_CLIENT_LLM=false、CORS_ALLOW_ORIGINS、OPENAI_* 等
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
