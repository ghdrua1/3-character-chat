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

# services/chatbot_service.py 파일에서 generate_response 함수를 아래 코드로 교체하세요.

    def generate_response(self, user_message: str, suspect_id: str = None) -> dict:
        # 'init' 메시지는 특별 처리
        if user_message.strip().lower() == "init":
            # _handle_briefing은 questions_left를 반환하지 않으므로, 여기서 직접 추가해줍니다.
            response = self._handle_briefing(user_message)
            response['questions_left'] = self.game_session.get('questions_left', 15)
            response['mode'] = self.game_session.get('mode')
            return response

        current_mode = self.game_session.get("mode")
        handler_result = {} # 각 핸들러의 결과(reply, sender)를 저장할 임시 변수

        if current_mode == "error":
            handler_result = {"reply": f"게임 초기화 오류: {self.game_session.get('error_message')}", "sender": "system"}
        elif current_mode == "briefing":
            handler_result = self._handle_briefing(user_message)
        elif current_mode == "interrogation":
            if not suspect_id:
                handler_result = {"reply": "심문할 용의자를 선택해 주십시오.", "sender": "system"}
            else:
                # _handle_interrogation 함수가 실행되면, 내부적으로 질문 횟수가 차감됩니다.
                handler_result = self._handle_interrogation(user_message, suspect_id)
        else:
             handler_result = {"reply": "게임 모드 설정에 오류가 발생했습니다.", "sender": "system"}
        
        # 모든 로직이 끝난 후, 최종적으로 업데이트된 세션 정보를 바탕으로 응답을 구성합니다.
        final_response = {
            "reply": handler_result.get("reply"),
            "sender": handler_result.get("sender"),
            "questions_left": self.game_session.get("questions_left", 0),
            "mode": self.game_session.get("mode")
        }
        return final_response
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
                   # === 디버깅을 위해 이 print 문을 추가하세요! ===
            print("======== FINAL PROMPT TO LLM ========")
            print(final_prompt)
            print("=====================================")

            response = self.client.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": final_prompt}], temperature=0.7, max_tokens=300)
            reply = response.choices[0].message.content.strip()
            self.game_session["questions_left"] -= 1
            self._save_to_history(suspect_id, user_message, reply)
            return {"reply": reply, "sender": suspect_id}
        except Exception as e:
            import traceback; traceback.print_exc()
            return {"reply": "죄송합니다. 생각에 잠시 오류가 생긴 것 같습니다...", "sender": suspect_id}

# services/chatbot_service.py 의 make_accusation 함수

    def make_accusation(self, accused_suspect_id: str) -> dict:
        real_killer_id = self.game_session["killer"]
        is_correct = (accused_suspect_id == real_killer_id)
        
        final_prompt = ""
        sender_id = accused_suspect_id
        
        if is_correct:
            killer_config = self._load_suspect_config(real_killer_id)
            # === [수정] 범인의 '자백용' 상세 정보를 knowledge.json에서 가져옴 ===
            killer_knowledge = self._load_suspect_knowledge(real_killer_id)
            confession_details = killer_knowledge.get("killer_confession_details", {})
            
            persona_str = "\n".join([f"- {key}: {value}" for key, value in killer_config.get("persona_details", {}).items()])
            final_prompt = f"""
# 총괄 지시
너는 마침내 정체가 탄로난 범인 '{killer_config['name']}'이다. 탐정 'Adrian Vale'이 너를 범인으로 지목했다.
# 너의 상세 페르소나
{persona_str}
# 너의 현재 마음가짐
{killer_config['system_prompt_killer']}
# 너의 범행 기록 (이 내용을 바탕으로 자백하라)
- 범행 동기(왜): {confession_details.get('why')}
- 범행 방식(어떻게): {confession_details.get('how')}
# 핵심 임무
탐정이 너를 범인으로 지목한 이 마지막 순간, 너의 페르소나에 맞춰 모든 것을 자백하는 극적인 최종 변론을 하라. 위의 '너의 범행 기록'에 있는 동기와 방식을 반드시 포함하여 절절하게 토로하며 대사를 마무리하라."""
        else:
            innocent_config = self._load_suspect_config(accused_suspect_id)
            killer_config = self._load_suspect_config(real_killer_id)
            sender_id = "system" 
            
            # === [수정] 진범의 '범행 기록'을 knowledge.json에서 가져옴 ===
            killer_knowledge = self._load_suspect_knowledge(real_killer_id)
            confession_details = killer_knowledge.get("killer_confession_details", {})
            
            innocent_persona_str = "\n".join([f"- {key}: {value}" for key, value in innocent_config.get("persona_details", {}).items()])
            final_prompt = f"""
# 총괄 지시
당신은 사건의 진실을 설명하는 '사건 해설자'이다. 절대로 새로운 이야기를 창작하지 말고, 아래에 주어진 '사실'만을 바탕으로 서술하라.

# 상황
탐정 'Adrian Vale'이 '{innocent_config['name']}'을 범인으로 지목했지만, 틀렸다.

# 핵심 임무
1. 먼저, 억울하게 지목된 '{innocent_config['name']}'의 페르소나를 참고하여 그의 억울함이 담긴 짧은 반박 대사를 생성하라.
   - 페르소나: {innocent_persona_str}
   - 상황: {innocent_config['system_prompt_innocent']}

2. 이어서, 아래 주어진 '사건의 진실' 정보를 바탕으로, 담담하고 객관적인 톤의 나레이션을 작성하라.
   - **사건의 진실 (Fact Sheet):**
     - 진범: {killer_config['name']}
     - 진범의 동기(왜): {confession_details.get('why')}
     - 진범의 범행 방식(어떻게): {confession_details.get('how')}
"""

        response = self.client.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": final_prompt}], temperature=0.7, max_tokens=500)
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
        
# services/chatbot_service.py 의 _build_final_prompt 함수

    def _build_final_prompt(self, suspect_config, system_prompt, history, user_message, retrieved_doc):
        persona_str = "\n".join([f"- {key}: {value}" for key, value in suspect_config.get("persona_details", {}).items()])
        
        case_brief = f"""
### 배경 정보
- 사건: 할로슬랍 스테이션 살인사건
- 피해자: 기자, Elias Cole
- 당신의 신분: 위 사건의 용의자 중 한 명"""
        
        if retrieved_doc:
            fact_to_use = retrieved_doc['fact']
            lie_behavior = retrieved_doc.get('lie_behavior', '')
            # === 여기가 최종 수정된 프롬프트입니다! ===
            return f"""{case_brief}

### 너의 프로필
{persona_str}

### 너의 현재 마음가짐
{system_prompt}

### 너의 태도 (Attitude)
- 너는 탐정을 돕는 조력자가 아니다. 너는 **방어적인 용의자**다.
- 탐정의 질문에 최소한의 정보만 제공하고, 먼저 나서서 추가 정보를 주거나 "도움이 되나요?" 같은 협조적인 질문을 절대 하지 마라.
- 모든 답변은 너의 페르소나와 현재 상황(결백 또는 범인)에 기반해야 한다.

### 너의 속마음 (비밀 생각 - 절대로 그대로 말하지 말고, 연기의 바탕으로만 삼을 것)
- 탐정의 질문 "{user_message}"에 대해, 너는 사실 이렇게 알고 있다: "{fact_to_use}"
- 만약 네가 범인이라면, 거짓말을 들키지 않기 위한 행동 지침: "{lie_behavior}"

### 지시:
위 '너의 속마음'을 바탕으로, 너의 '프로필'과 '태도'에 맞춰 탐정의 마지막 질문에 대한 답변을 생성하라.

### 대화 내용
{history}
{suspect_config['name']}: """
        else:
            responses = suspect_config.get("situational_responses", {})
            greeting_ex = responses.get("greeting", "억울합니다.")
            accusation_ex = responses.get("accusation", "제가 아닙니다.")
            irrelevant_ex = responses.get("irrelevant_word", "그게 무슨 상관이죠?")

            return f"""{case_brief}

### 너의 프로필
{persona_str}

### 너의 현재 마음가짐
{system_prompt}

### 너의 태도 (Attitude)
- 너는 탐정을 돕는 조력자가 아니다. 너는 **방어적인 용의자**다.
- 탐정의 뜬금없는 말에 친절하게 설명해주려 하지 말고, 너의 성격에 맞게 반응하라.

### 너의 성격에 맞는 반응 예시
- 탐정이 "안녕하세요" 라고 인사했을 때: "{greeting_ex}"
- 탐정이 "당신이 범인이지?" 라고 공격적으로 물었을 때: "{accusation_ex}"
- 탐정이 "김치찌개" 라고 뜬금없는 단어를 말했을 때: "{irrelevant_ex}"

### 지시:
위 예시들을 참고하여, 탐정의 말("{user_message}")에 대한 너의 자연스러운 반응을 생성하라.

### 대화 내용
{history}
{suspect_config['name']}: """

# services/chatbot_service.py 의 _create_active_knowledge 함수

    def _create_active_knowledge(self, suspect_ids, killer):
        active_knowledge = {}
        for suspect_id in suspect_ids:
            raw_knowledge = self._load_suspect_knowledge(suspect_id)
            if not raw_knowledge: continue
            
            is_killer_flag = (suspect_id == killer)
            
            # === 여기가 최종 업그레이드된 부분입니다! ===
            combined_knowledge = []
            # 이제 세 개의 모든 섹션을 순회하며 지식을 통합합니다.
            for section in ["core_facts", "suspicion_points_response", "interrogation_points"]:
                for item in raw_knowledge.get(section, []):
                    item_copy = item.copy()
                    
                    # 'fact_innocent'/'fact_killer'가 있는 경우와 'fact'만 있는 경우를 모두 처리
                    if is_killer_flag and 'fact_killer' in item:
                        item_copy['fact'] = item['fact_killer']
                    elif 'fact_innocent' in item:
                        item_copy['fact'] = item['fact_innocent']
                    # 'fact' 키가 이미 존재한다면 (core_facts), 아무것도 하지 않음
                    
                    item_copy['lie_behavior'] = item.get('lie_behavior', '') if is_killer_flag else ''
                    combined_knowledge.append(item_copy)
            
            active_knowledge[suspect_id] = combined_knowledge
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