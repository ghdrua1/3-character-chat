# services/chatbot_service.py

import os
import json
import random
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

# 환경변수 로드
load_dotenv()

# 프로젝트 루트 경로
BASE_DIR = Path(__file__).resolve().parent.parent

class ChatbotService:
    def __init__(self):
        print("[ChatbotService] 초기화 중...")
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY 환경변수가 설정되지 않았습니다.")
        self.client = OpenAI(api_key=api_key)
        
        self.game_session = {}
        self.start_new_game()
        print("[ChatbotService] 초기화 완료. 새로운 게임이 준비되었습니다.")
    
    def start_new_game(self):
        suspect_ids = ['leonard', 'walter', 'clara']
        killer = random.choice(suspect_ids)
        
        nathan_script = self._load_nathan_script()
        # nathan_script가 None이면 치명적 오류이므로 여기서 멈추도록 처리
        if nathan_script is None:
            print("[FATAL] Nathan 스크립트 로딩 실패. 게임을 시작할 수 없습니다.")
            # 오류 상황을 명확히 하기 위해 game_session을 비워둠
            self.game_session = {"mode": "error", "error_message": "Nathan script not found."}
            return

        clues = nathan_script.get('clues', {}).get(killer, {})

        active_knowledge = {}
        for suspect_id in suspect_ids:
            raw_knowledge = self._load_suspect_knowledge(suspect_id)
            is_killer_flag = (suspect_id == killer)
            
            processed_knowledge = []
            for item in raw_knowledge.get("knowledge", []):
                fact_to_use = item['fact_killer'] if is_killer_flag else item['fact_innocent']
                processed_knowledge.append({
                    "id": item['id'], "keywords": item['keywords'], "fact": fact_to_use,
                    "lie_behavior": item.get('lie_behavior', '') if is_killer_flag else ''
                })
            active_knowledge[suspect_id] = processed_knowledge

        self.game_session = {
            "killer": killer, "clues": clues, "nathan_script": nathan_script,
            "active_knowledge": active_knowledge, "history": {s_id: [] for s_id in suspect_ids},
            "mode": "briefing"
        }
        print(f"--- 새로운 게임 시작 ---")
        print(f"이번 사건의 범인은 '{killer}' 입니다.")

    def generate_response(self, user_message: str, suspect_id: str = None) -> dict:
        current_mode = self.game_session.get("mode")

        if current_mode == "error":
            return {"reply": f"게임 초기화 오류: {self.game_session.get('error_message')}", "sender": "system"}

        if current_mode == "briefing":
            return self._handle_briefing(user_message)
        
        elif current_mode == "interrogation":
            if not suspect_id:
                return {"reply": "심문할 용의자를 선택해 주십시오.", "sender": "system"}
            return self._handle_interrogation_placeholder(user_message, suspect_id)
        
        return {"reply": "게임 모드 설정에 오류가 발생했습니다.", "sender": "system"}

    def _handle_briefing(self, user_message: str) -> dict:
        # self.game_session["nathan_script"] 가 없을 경우를 대비한 안전장치
        if "nathan_script" not in self.game_session or not self.game_session["nathan_script"]:
             return {"reply": "오류: Nathan의 스크립트를 로드할 수 없습니다. 파일을 확인해주세요.", "sender": "system"}
        
        script = self.game_session["nathan_script"]["briefing"]
        
        if user_message.strip().lower() == "init":
            return {"reply": script["intro"], "sender": "nathan"}
        
        if any(keyword in user_message for keyword in ["알겠습니다", "알겠", "시작"]):
            self.game_session["mode"] = "interrogation"
            initial_clue = self.game_session["clues"]["initial"]
            reply = f"좋습니다, 탐정님. 첫 번째 단서를 드리죠.\n\n[단서]: {initial_clue}"
            reply += script["start_interrogation"]
            return {"reply": reply, "sender": "nathan"}
        
        return {"reply": script["default"], "sender": "nathan"}

    def _handle_interrogation_placeholder(self, user_message: str, suspect_id: str) -> dict:
        suspect_config = self._load_suspect_config(suspect_id)
        if not suspect_config:
             return {"reply": f"오류: {suspect_id}의 설정 파일을 찾을 수 없습니다.", "sender": "system"}
        
        suspect_name = suspect_config.get("name", suspect_id)
        knowledge_base = self.game_session["active_knowledge"][suspect_id]
        retrieved_doc = self._search_similar(user_message, knowledge_base)

        if retrieved_doc:
            reply = f"({suspect_name}): [RAG 성공] (다음 단계에서 LLM 답변 생성)"
        else:
            reply = f"({suspect_name}): [RAG 실패] (다음 단계에서 주제 이탈 대응)"
        return {"reply": reply, "sender": suspect_id}

    def _search_similar(self, query: str, knowledge_base: list) -> dict | None:
        query = query.lower()
        for doc in knowledge_base:
            for keyword in doc.get("keywords", []):
                if keyword.lower() in query:
                    return doc
        return None

    # ====================================================================
    # === 여기가 바로 우리가 심어둔 '수사관' 코드입니다! (디버깅 함수) ===
    # ====================================================================
    def _load_json_file(self, file_path: Path) -> dict | None:
        print("\n" + "="*50)
        print(f"[DEBUG] JSON 파일 로딩 시도...")
        print(f"[DEBUG] 계산된 파일 경로: {file_path}")
        
        if not file_path.exists():
            print(f"[DEBUG] 결과: 실패! 이 경로에 파일이 존재하지 않습니다.")
            print("="*50 + "\n")
            return None
        else:
            print(f"[DEBUG] 결과: 성공! 파일이 존재합니다.")

        try:
            content = file_path.read_text(encoding='utf-8')
            print(f"[DEBUG] 파일 내용 읽기 성공. 내용 미리보기:")
            print(content[:200] + "...")
            
            data = json.loads(content)
            print(f"[DEBUG] JSON 파싱 성공.")
            print("="*50 + "\n")
            return data
        except Exception as e:
            print(f"[DEBUG] 결과: 실패! 파일을 읽거나 파싱하는 중 오류 발생.")
            print(f"[DEBUG] 오류 상세 내용: {e}")
            print("="*50 + "\n")
            return None

    def _load_nathan_script(self) -> dict:
        file_path = BASE_DIR / "static/data/chatbot/case_files/nathan_hale_script.json"
        return self._load_json_file(file_path)

    def _load_suspect_config(self, suspect_id: str) -> dict:
        config_map = {'leonard': 'leonard_graves.json', 'walter': 'walter_briggs.json', 'clara': 'clara_hwang.json'}
        file_name = config_map.get(suspect_id)
        if not file_name: return None
        file_path = BASE_DIR / "config" / file_name
        return self._load_json_file(file_path)

    def _load_suspect_knowledge(self, suspect_id: str) -> dict:
        folder_map = {'leonard': 'leonard_graves', 'walter': 'walter_briggs', 'clara': 'clara_hwang'}
        folder_name = folder_map.get(suspect_id)
        if not folder_name: return None
        file_path = BASE_DIR / "static/data/chatbot/chardb_text" / folder_name / "knowledge.json"
        return self._load_json_file(file_path)

_chatbot_service = None

def get_chatbot_service():
    global _chatbot_service
    if _chatbot_service is None:
        _chatbot_service = ChatbotService()
    return _chatbot_service