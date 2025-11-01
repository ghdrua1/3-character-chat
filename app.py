# app.py

import os
import json
from pathlib import Path
from flask import Flask, request, render_template, jsonify, url_for
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__)
app.secret_key = os.getenv('SECRET_KEY', 'dev-secret-key-change-this')
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
BASE_DIR = Path(__file__).resolve().parent

def load_config():
    CONFIG_PATH = BASE_DIR / 'config' / 'chatbot_config.json'
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f: return json.load(f)
    except FileNotFoundError:
        return {'name': '챗봇', 'description': '설명', 'tags': [], 'thumbnail': ''}

config = load_config()

@app.route('/')
def index():
    return render_template('index.html', bot=config)

@app.route('/detail')
def detail():
    return render_template('detail.html', bot=config)

@app.route('/chat')
def chat():
    username = request.args.get('username', '탐정')
    bot_name = config.get('name', '사건 파일')
    return render_template('chat.html', bot_name=bot_name, username=username)

# === [최종 수정] 새로운 게임 시작 API 추가 ===
@app.route('/api/start_new_game', methods=['POST'])
def start_new_game():
    from services import get_chatbot_service
    chatbot = get_chatbot_service()
    chatbot.start_new_game() # ChatbotService의 게임 초기화 함수를 직접 호출
    return jsonify({"message": "New game started successfully."})
# ============================================

@app.route('/api/chat', methods=['POST'])
def api_chat():
    try:
        data = request.get_json()
        user_message = data.get('message', '')
        suspect_id = data.get('suspect_id')
        if not user_message:
            return jsonify({'error': 'Message is required'}), 400
        from services import get_chatbot_service
        chatbot = get_chatbot_service()
        response = chatbot.generate_response(user_message, suspect_id)
        return jsonify(response)
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'reply': '죄송해요, 서버에서 처리 중 오류가 발생했어요.', 'sender': 'system'}), 500

@app.route('/api/recommendations', methods=['GET'])
def api_recommendations():
    suspect_id = request.args.get('suspect_id')
    if not suspect_id:
        return jsonify({'error': 'suspect_id is required'}), 400
    from services import get_chatbot_service
    chatbot = get_chatbot_service()
    questions = chatbot.get_recommended_questions(suspect_id)
    return jsonify(questions)

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_ENV') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)