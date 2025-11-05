# Python 3.11 slim 이미지 사용 (경량화)
FROM python:3.11-slim

# 작업 디렉토리 설정
WORKDIR /app

# 시스템 패키지 업데이트 및 필수 패키지 설치
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Python 의존성 파일 복사
COPY requirements.txt .

# Python 패키지 설치
RUN pip install --no-cache-dir -r requirements.txt

# 애플리케이션 코드 복사
COPY . .

# ChromaDB 데이터 디렉토리 생성
RUN mkdir -p static/data/chatbot/chardb_embedding \
    static/data/chatbot/imagedb_embedding

# 환경변수 기본값 설정
ENV FLASK_ENV=production
ENV FLASK_DEBUG=False
ENV PORT=5000

# 포트 노출
EXPOSE 5000

# 헬스체크 설정 (PORT 환경변수 사용, 기본값 5000)
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD ["/bin/sh", "-c", "python -c \"import urllib.request, os; port = os.getenv('PORT', '5000'); urllib.request.urlopen(f'http://localhost:{port}/health')\""]

# 애플리케이션 실행 (gunicorn 사용)
# Render와 동일하게 gunicorn으로 실행, PORT 환경변수 사용
# 쉘 형식 사용으로 환경변수 치환 가능
CMD ["/bin/sh", "-c", "gunicorn app:app --bind 0.0.0.0:${PORT:-5000} --workers 2 --timeout 120"]
