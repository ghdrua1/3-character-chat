# services/chatbot_service.py

import os
import json
import random
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
BASE_DIR = Path(__file__).resolve().parent.parent

class ChatbotService:
    def __init__(self):
        print("[ChatbotService] 초기화 중...")
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key or len(api_key) < 10:
            raise ValueError("OPENAI_API_KEY 환경변수가 유효하지 않습니다. .env 파일을 확인해주세요.")
        self.client = OpenAI(api_key=api_key)
        self.game_session = {}
        self.start_new_game()
        print("[ChatbotService] 초기화 완료. 새로운 게임이 준비되었습니다.")
    
    def start_new_game(self):
        suspect_ids = ['leonard', 'walter', 'clara']
        killer = random.choice(suspect_ids)
        nathan_script = self._load_nathan_script()
        if nathan_script is None:
            self.game_session = {"mode": "error", "error_message": "Nathan script not found."}
            return
        clues = nathan_script.get('clues', {}).get(killer, {})
        active_knowledge = self._create_active_knowledge(suspect_ids, killer)
        self.game_session = {
            "killer": killer, "clues": clues, "nathan_script": nathan_script,
            "active_knowledge": active_knowledge, "history": {s_id: [] for s_id in suspect_ids},
            "mode": "briefing", "questions_left": 15
        }
        print(f"--- 새로운 게임 시작 ---")
        print(f"이번 사건의 범인은 '{killer}' 입니다.")

    def generate_response(self, user_message: str, suspect_id: str = None) -> dict:
        if user_message.strip().lower() == "init":
            return self._handle_briefing(user_message)
        current_mode = self.game_session.get("mode")
        questions_left = self.game_session.get("questions_left", 0)
        
        response = {"questions_left": questions_left, "mode": current_mode}

        if current_mode == "error":
            response.update({"reply": f"게임 초기화 오류: {self.game_session.get('error_message')}", "sender": "system"})
        elif current_mode == "briefing":
            response.update(self._handle_briefing(user_message))
        elif current_mode == "interrogation":
            if not suspect_id:
                response.update({"reply": "심문할 용의자를 선택해 주십시오.", "sender": "system"})
            else:
                response.update(self._handle_interrogation(user_message, suspect_id))
        else:
             response.update({"reply": "게임 모드 설정에 오류가 발생했습니다.", "sender": "system"})
        
        return response

    def _handle_briefing(self, user_message: str) -> dict:
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

    def _handle_interrogation(self, user_message: str, suspect_id: str) -> dict:
        try:
            if self.game_session["questions_left"] <= 0:
                return {"reply": "더 이상 질문할 수 없습니다. 이제 범인을 지목해야 합니다.", "sender": "system"}
            
            is_killer = (self.game_session["killer"] == suspect_id)
            suspect_config = self._load_suspect_config(suspect_id)
            knowledge_base = self.game_session["active_knowledge"][suspect_id]
            retrieved_doc = self._search_similar(user_message, knowledge_base)
            system_prompt = suspect_config['system_prompt_killer'] if is_killer else suspect_config['system_prompt_innocent']
            history = self._get_conversation_history(suspect_id, user_message)
            final_prompt = self._build_final_prompt(suspect_config, system_prompt, history, user_message, retrieved_doc)
            response = self.client.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": final_prompt}], temperature=0.7, max_tokens=300)
            reply = response.choices[0].message.content.strip()

            self.game_session["questions_left"] -= 1
            self._save_to_history(suspect_id, user_message, reply)
            return {"reply": reply, "sender": suspect_id}
        except Exception as e:
            import traceback; traceback.print_exc()
            return {"reply": "죄송합니다. 생각에 잠시 오류가 생긴 것 같습니다...", "sender": suspect_id}

    def make_accusation(self, accused_suspect_id: str) -> dict:
        real_killer_id = self.game_session["killer"]
        is_correct = (accused_suspect_id == real_killer_id)
        
        final_prompt = ""
        sender_id = accused_suspect_id
        
        if is_correct:
            killer_config = self._load_suspect_config(real_killer_id)
            final_prompt = f"""
# Master Instruction
당신은 마침내 정체가 탄로난 범인 '{killer_config['name']}'입니다. 탐정 'Adrian Vale'이 당신의 모든 거짓말을 꿰뚫어보고, 당신을 범인으로 지목했습니다. 더 이상 빠져나갈 길이 없습니다.
# Persona
{killer_config['system_prompt_killer']}
# Task
탐정이 당신을 범인으로 지목한 이 마지막 순간, 당신의 페르소나에 맞춰 모든 것을 자백하는 극적인 최종 변론을 하세요. 왜 피해자를 죽여야만 했는지, 당신의 동기를 절절하게 토로하며 대사를 마무리하세요."""
        else:
            innocent_config = self._load_suspect_config(accused_suspect_id)
            killer_config = self._load_suspect_config(real_killer_id)
            sender_id = "system" 
            final_prompt = f"""
# Master Instruction
당신은 뛰어난 스토리텔러입니다. 탐정 'Adrian Vale'이 '{innocent_config['name']}'을 범인으로 지목했지만, 틀렸습니다. 진범은 '{killer_config['name']}'입니다.
# Task
1. 먼저, 억울하게 지목된 '{innocent_config['name']}'의 페르소나({innocent_config['system_prompt_innocent']})에 맞춰, 그의 억울함과 절망이 담긴 짧은 반박 대사를 생성하세요.
2. 이어서, 사건의 진실을 설명하는 나레이션을 작성하세요. 왜 진범이 '{killer_config['name']}'일 수밖에 없었는지, 그의 결정적인 동기와 증거를 언급하며 비극적인 사건의 전말을 서술하세요."""

        response = self.client.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": final_prompt}], temperature=0.8, max_tokens=500)
        final_statement = response.choices[0].message.content.strip()

        return {
            "result": "success" if is_correct else "failure",
            "final_statement": final_statement,
            "sender": sender_id,
            "is_game_over": True
        }

    def get_recommended_questions(self, suspect_id: str) -> list:
        knowledge = self._load_suspect_knowledge(suspect_id)
        return knowledge.get("recommended_questions", []) if knowledge else []
        
    def _build_final_prompt(self, suspect_config, system_prompt, history, user_message, retrieved_doc):
        if retrieved_doc:
            fact_to_use = retrieved_doc['fact']
            lie_behavior = retrieved_doc['lie_behavior']
            return f"""# Master Instruction
당신은 용의자 '{suspect_config['name']}'입니다. 탐정 'Adrian Vale'과 대화하고 있습니다. 역할에 완벽하게 몰입하여, 자연스럽게 대답하세요. 절대로 AI이거나 연기 중이라는 사실을 드러내지 마세요.
# Persona
{system_prompt}
# Internal Monologue (연기 지침 - 절대로 입 밖에 내지 말 것)
- 당신이 알고 있는 사실 또는 거짓말: "{fact_to_use}"
- 만약 범인이라면, 거짓말을 들키지 않기 위한 행동 지침: "{lie_behavior}"
# Conversation
{history}
{suspect_config['name']}: """
        else:
            return f"""
# Master Instruction
당신은 용의자 '{suspect_config['name']}'입니다. 탐정 'Adrian Vale'과 대화하고 있습니다. 그런데 탐정이 사건과 관련 없어 보이는 뜬금없는 질문을 던졌습니다.
# Persona
{system_prompt}
# Task
당신의 성격과 현재 심문받는 상황에 맞게, 뜬금없는 질문에 대해 자연스럽게 반응하세요. 질문의 의도를 되묻거나, 당황하거나, 불쾌감을 표시할 수 있습니다. 절대로 질문 자체에 대해 친절하게 설명해주지 마세요.
# Conversation
{history}
{suspect_config['name']}: """

    def _create_active_knowledge(self, suspect_ids, killer):
        active_knowledge = {}
        for suspect_id in suspect_ids:
            raw_knowledge = self._load_suspect_knowledge(suspect_id)
            if not raw_knowledge: continue
            is_killer_flag = (suspect_id == killer)
            processed_knowledge = []
            for item in raw_knowledge.get("knowledge", []):
                processed_knowledge.append({
                    "id": item['id'], "keywords": item['keywords'],
                    "fact": item['fact_killer'] if is_killer_flag else item['fact_innocent'],
                    "lie_behavior": item.get('lie_behavior', '') if is_killer_flag else ''
                })
            active_knowledge[suspect_id] = processed_knowledge
        return active_knowledge

    def _search_similar(self, query: str, knowledge_base: list) -> dict | None:
        query_words = set(query.lower().replace("?", "").replace(".", "").split())
        best_match, max_score = None, 0
        for doc in knowledge_base:
            doc_keywords = set(k.lower() for k in doc.get("keywords", []))
            score = len(query_words.intersection(doc_keywords))
            if score > max_score:
                max_score, best_match = score, doc
        return best_match if max_score > 0 else None

    def _get_conversation_history(self, suspect_id: str, current_user_message: str, limit: int = 4) -> str:
        history = self.game_session["history"][suspect_id][-limit:]
        suspect_config = self._load_suspect_config(suspect_id)
        suspect_name = suspect_config.get("name", "용의자")
        formatted_history = "\n".join([f"탐정: {turn['user']}\n{suspect_name}: {turn['bot']}" for turn in history])
        formatted_history += f"\n탐정: {current_user_message}"
        return formatted_history

    def _save_to_history(self, suspect_id: str, user_message: str, bot_reply: str):
        self.game_session["history"][suspect_id].append({"user": user_message, "bot": bot_reply})

    def _load_json_file(self, file_path: Path) -> dict | None:
        if not file_path.exists(): return None
        try: return json.loads(file_path.read_text(encoding='utf-8'))
        except: return None

    def _load_nathan_script(self) -> dict:
        return self._load_json_file(BASE_DIR / "static/data/chatbot/case_files/nathan_hale_script.json")

    def _load_suspect_config(self, suspect_id: str) -> dict:
        map = {'leonard': 'leonard_graves.json', 'walter': 'walter_briggs.json', 'clara': 'clara_hwang.json'}
        path = map.get(suspect_id)
        return self._load_json_file(BASE_DIR / "config" / path) if path else None

    def _load_suspect_knowledge(self, suspect_id: str) -> dict:
        map = {'leonard': 'leonard_graves', 'walter': 'walter_briggs', 'clara': 'clara_hwang'}
        path = map.get(suspect_id)
        return self._load_json_file(BASE_DIR / "static/data/chatbot/chardb_text" / path / "knowledge.json") if path else None

_chatbot_service = None
def get_chatbot_service():
    global _chatbot_service
    if _chatbot_service is None: _chatbot_service = ChatbotService()
    return _chatbot_service