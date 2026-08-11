FROM python:3.11-slim
WORKDIR /app
COPY src/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src/ .
COPY docs /app/docs
COPY docs_buyer /app/docs_buyer
EXPOSE 8007
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8007"]
