# services/chatbot_service.py

import os
import json
import random
import threading
import time
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
import chromadb
from chromadb.config import Settings

load_dotenv()
# Chroma 텔레메트리 비활성화 (에러 로그 및 불필요한 지연 방지)
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("CHROMA_TELEMETRY_ENABLED", "False")
BASE_DIR = Path(__file__).resolve().parent.parent

class ChatbotService:
    def __init__(self):
        print("[ChatbotService] 초기화 중...")
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key or len(api_key) < 10:
            raise ValueError("OPENAI_API_KEY 환경변수가 유효하지 않습니다. .env 파일을 확인해주세요.")
        self.client = OpenAI(api_key=api_key)
        
        # ChromaDB 초기화
        print("[ChromaDB] 벡터 DB 초기화 중...")
        chroma_path = BASE_DIR / "static/data/chatbot/chardb_embedding"
        chroma_path.mkdir(parents=True, exist_ok=True)
        
        self.chroma_client = chromadb.PersistentClient(
            path=str(chroma_path),
            settings=Settings(
                anonymized_telemetry=False,
                allow_reset=True
            )
        )
        
        self.game_session = {}
        # 용의자별 벡터 DB 구축 여부/빌드중 캐시
        self._vdb_built_for: set[str] = set()
        self._vdb_building: set[str] = set()
        self.start_new_game()
        print("[ChatbotService] 초기화 완료. 새로운 게임이 준비되었습니다.")

    def start_new_game(self):
        suspect_ids = ['leonard', 'walter', 'clara']
        killer = random.choice(suspect_ids)
        nathan_script = self._load_nathan_script()
        if nathan_script is None:
            self.game_session = {"mode": "error", "error_message": "Nathan script not found."}
            return
        
        active_knowledge = self._create_active_knowledge(suspect_ids, killer)
        # 게임 시작 시에는 벡터DB를 즉시 구축하지 않고, 최초 심문 시점에 용의자별 1회 구축합니다.
        self._vdb_built_for.clear()
        self.game_session = {
            "killer": killer, "nathan_script": nathan_script,
            "active_knowledge": active_knowledge, "history": {s_id: [] for s_id in suspect_ids},
            "mode": "briefing", "questions_left": 15,
            "mid_report_done": False
        }
        print(f"--- 새로운 게임 시작 --- 범인은 '{killer}' 입니다.")
        # 브리핑에는 영향 없이, 백그라운드에서 프리워밍 시작
        threading.Thread(target=self._warmup_in_background, daemon=True).start()
    def generate_response(self, user_message: str, suspect_id: str = None) -> dict:
        # 1. 상황에 맞는 핸들러를 호출하여 결과를 받습니다.
        if user_message.strip().lower() == "init":
            handler_result = self._handle_briefing(user_message)
        else:
            current_mode = self.game_session.get("mode")
            if current_mode == "briefing":
                handler_result = self._handle_briefing(user_message)
            elif current_mode == "interrogation":
                if not suspect_id:
                    handler_result = {"reply": "심문할 용의자를 선택해 주십시오.", "sender": "system"}
                else:
                    handler_result = self._handle_interrogation(user_message, suspect_id)
            else:
                handler_result = {"reply": "게임 모드 설정에 오류가 발생했습니다.", "sender": "system"}

        # 2. 핸들러가 반환한 결과에 최신 상태 정보만 덧붙여 최종 응답을 완성합니다.
        final_response = handler_result.copy()
        final_response["questions_left"] = self.game_session.get("questions_left", 0)
        final_response["mode"] = self.game_session.get("mode")

        return final_response
# services/chatbot_service.py 파일에서 _handle_briefing 함수를 아래 코드로 교체하세요.

    def _handle_briefing(self, user_message: str) -> dict:
        script_briefing = self.game_session["nathan_script"]["briefing"]
        
        if user_message.strip().lower() == "init":
            initial_scenes = script_briefing.get("scenes", [])
            return { "messages": initial_scenes }
        
        if any(keyword in user_message.lower() for keyword in ["알겠습니다", "알겠", "시작", "네", "계속"]):
            self.game_session["mode"] = "interrogation"
            
            report_scenes_template = script_briefing.get("report_scenes", [])
            killer = self.game_session.get("killer") # 현재 게임의 범인을 가져옵니다.

            processed_scenes = []
            for scene in report_scenes_template:
                scene_copy = scene.copy() # 원본 데이터 수정을 방지하기 위해 복사
                
                # [핵심 수정] 'conditional_image' 키가 있는지 확인합니다.
                if "conditional_image" in scene_copy:
                    image_options = scene_copy.pop("conditional_image") # conditional_image는 제거
                    
                    # 범인에 맞는 이미지를 선택하거나, 없으면 default 이미지를 사용합니다.
                    image_to_use = image_options.get(killer, image_options.get("default"))
                    
                    if image_to_use:
                        scene_copy["image"] = image_to_use # 최종적으로 'image' 키에 할당
                
                processed_scenes.append(scene_copy)

            return {
                "messages": processed_scenes,
                "mode": "interrogation"
            }

        return {"reply": "준비되시면 '알겠습니다'라고 말씀해주십시오.", "sender": "nathan"}
    
    def _handle_interrogation(self, user_message: str, suspect_id: str) -> dict:
        try:
            if self.game_session["questions_left"] <= 0:
                return {"reply": "더 이상 질문할 수 없습니다. 이제 범인을 지목해야 합니다.", "sender": "system", "image": None}

            # --- 용의자 답변 생성 (벡터 검색 RAG) ---
            # 벡터DB 보장: 해당 용의자 컬렉션이 없거나 아직 구축 전이면 지금 1회 구축
            self._ensure_vector_db_for_suspect(suspect_id)
            is_killer = (self.game_session["killer"] == suspect_id)
            suspect_config = self._load_suspect_config(suspect_id)
            knowledge_base = self.game_session["active_knowledge"][suspect_id]
            retrieved_doc = self._search_similar(user_message, knowledge_base, suspect_id)
            
            # 증거 이미지가 있으면 우선 사용, 없으면 감정 이미지 사용
            evidence_image = retrieved_doc.get("image") if retrieved_doc else None
            
            system_prompt = suspect_config['system_prompt_killer'] if is_killer else suspect_config['system_prompt_innocent']
            history = self._get_conversation_history(suspect_id, user_message)
            final_prompt = self._build_final_prompt(suspect_config, system_prompt, history, user_message, retrieved_doc)
            response = self.client.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": final_prompt}], temperature=0.7, max_tokens=300)
            reply = response.choices[0].message.content.strip()
            
            # --- 감정 분석 및 이미지 선택 ---
            if evidence_image:
                # 증거 이미지가 있으면 우선 사용
                image_info_to_show = evidence_image
            else:
                # 증거 이미지가 없으면 감정 이미지 사용
                emotion = self._analyze_emotion(reply, suspect_id)
                emotion_image = self._get_emotion_image(suspect_id, emotion)
                image_info_to_show = emotion_image
            
            # --- 상태 업데이트 (기존 로직) ---
            self.game_session["questions_left"] -= 1
            self._save_to_history(suspect_id, user_message, reply)

            # --- [핵심 수정] 최종 응답 구성 ---
            # 1. 먼저 용의자의 답변을 기본 응답 객체에 담습니다.
            final_response = {"reply": reply, "sender": suspect_id, "image": image_info_to_show}

            # 2. 그 직후, 남은 질문이 8개인지(7번 질문이 끝난 상태인지) 확인합니다.
            if self.game_session.get("questions_left") == 8 and not self.game_session.get("mid_report_done"):
                self.game_session["mid_report_done"] = True
                killer = self.game_session["killer"]
                mid_game_report_scenes = self.game_session["nathan_script"]["mid_game_report"]
                
                processed_scenes = []
                for scene in mid_game_report_scenes:
                    scene_copy = scene.copy()
                    if "conditional_content" in scene_copy:
                        content = scene_copy.pop("conditional_content")[killer]
                        # conditional_content의 text와 image를 scene_copy에 합칩니다.
                        scene_copy["reply"] = scene_copy.get("reply", "") + content.get("text", "")
                        scene_copy["image"] = content.get("image")
                    processed_scenes.append(scene_copy)
                
                # 'additional_messages' 키에 순차적으로 보여줄 보고 내용을 담습니다.
                final_response["additional_messages"] = processed_scenes
            
            return final_response
            
        except Exception as e:
            import traceback; traceback.print_exc()
            return {"reply": "죄송합니다. 생각에 잠시 오류가 생긴 것 같습니다...", "sender": "suspect_id", "image": None}
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
1. 먼저, 억울하게 지목된 '{innocent_config['name']}'의 페르소나를 참고하여 의 억울함이 담긴 짧은 반박 대사를 생성하라.
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
        
        # 감정 분석 및 이미지 추가
        emotion = self._analyze_emotion(final_statement, accused_suspect_id)
        emotion_image = self._get_emotion_image(accused_suspect_id, emotion)

        # 아웃트로 시퀀스 구성 (브리핑과 유사한 순차 연출용)
        additional_messages = []
        try:
            real_killer_cfg = self._load_suspect_config(real_killer_id) or {}
            killer_knowledge = self._load_suspect_knowledge(real_killer_id) or {}
            confession_details = killer_knowledge.get("killer_confession_details", {})
            
            # 기본값 보장
            killer_name = real_killer_cfg.get('name', real_killer_id)
            
            # 진범 별 이미지 경로 계산: 분노(말다툼), 살인의 순간, 증거 이미지
            killer_folder_map = {
                'leonard': 'leonard_graves',
                'walter': 'walter_bridges',
                'clara': 'clara_hwang'
            }
            killer_folder = killer_folder_map.get(real_killer_id, real_killer_id)
            argument_img_path = f"static/images/{killer_folder}/분노.png"
            murder_img_path = (
                "static/images/evidence/crime_scene_walter.png"
                if real_killer_id == 'walter'
                else "static/images/evidence/crime_scene_blood.png"
            )
            # 진범별 증거 이미지 매핑
            clue_img_map = {
                'leonard': 'static/images/evidence/fake_ticket.png',
                'walter': 'static/images/evidence/oily_footprint.png',
                'clara': 'static/images/evidence/clean_scissors.png'
            }
            clue_img_path = clue_img_map.get(real_killer_id, 'static/images/evidence/oily_footprint.png')
            
            if is_correct:
                # 성공: 진범 자백 이후 회귀 컷씬([사건 회귀] 헤더→기사→비웃음→말다툼→공포→살인→엔딩)
                additional_messages = [
                    {"sender": "system", "reply": "[사건 회귀] 사건의 핵심 흐름을 정리합니다.", "image": None},
                    {"sender": "system", "reply": "기사의 취재 내용이 공개된 뒤 갈등이 본격화되었습니다. 기사는 피의자의 과거와 이해관계를 드러냈고, 양측의 감정이 고조되었습니다.", "image": {"path": "static/images/evidence/evidence_article.png", "alt": "취재 기사"}},
                    {"sender": "system", "reply": "피해자는 비웃음으로 대응했고, 이는 대화를 협박에 가까운 공방으로 악화시켰습니다.", "image": {"path": "static/images/outro/victim_mock.png", "alt": "기자의 비웃음"}},
                    {"sender": "system", "reply": "플랫폼 3에서 언쟁이 오갔고, 진범은 격앙된 상태였습니다.", "image": {"path": argument_img_path, "alt": "말다툼"}},
                    {"sender": "system", "reply": "피해자는 상황을 두려워하며 뒤로 물러났고, 대응이 늦었습니다.", "image": {"path": "static/images/outro/victim_fear.png", "alt": "피해자의 공포"}},
                    {"sender": "system", "reply": f"범행 동기: {confession_details.get('why','비공개')}\n범행 방식: {confession_details.get('how','비공개')}\n이 방식은 현장의 정황 증거와 일치합니다.", "image": {"path": murder_img_path, "alt": "사건 핵심"}},
                    {"sender": "system", "reply": "사건은 정리되었고, 마을은 다시 일상의 고요로 돌아갔습니다.", "image": {"path": "static/images/background/할로슬롭마을.png", "alt": "마을"}},
                    {"sender": "system", "reply": "탐정은 마지막으로 기록을 봉인하고 현장을 떠났습니다.", "image": {"path": "static/images/outro/detective_leave.png", "alt": "탐정의 퇴장"}},
                ]
            else:
                # 실패: 억울함/해설 이후 진실 회귀([사건 회귀] 헤더→기사→비웃음→말다툼→공포→살인→단서 해설→탐정 실망)
                additional_messages = [
                    {"sender": "system", "reply": "[사건 회귀] 사건의 전말을 정리합니다.", "image": None},
                    {"sender": "system", "reply": "보도된 기사로 인해 갈등이 증폭되었고, 피의자는 자신의 이해관계를 지키려 했습니다.", "image": {"path": "static/images/evidence/evidence_article.png", "alt": "취재 기사"}},
                    {"sender": "system", "reply": "피해자는 비웃음으로 맞섰고, 대화는 위협적 공방으로 번졌습니다.", "image": {"path": "static/images/outro/victim_mock.png", "alt": "기자의 비웃음"}},
                    {"sender": "system", "reply": "플랫폼에서 언쟁이 이어졌고, 진범은 격앙 상태였습니다.", "image": {"path": argument_img_path, "alt": "말다툼"}},
                    {"sender": "system", "reply": "피해자는 상황을 두려워하며 후퇴했고 대응이 지연되었습니다.", "image": {"path": "static/images/outro/victim_fear.png", "alt": "피해자의 공포"}},
                    {"sender": "system", "reply": f"실제 범인: {killer_name}\n동기: {confession_details.get('why','비공개')}\n수법: {confession_details.get('how','비공개')}.", "image": {"path": murder_img_path, "alt": "사건 핵심"}},
                    {"sender": "system", "reply": f"당신이 보았던 단서는 위 수법과 직접적으로 연결됩니다. 예를 들어 현장의 흔적(발자국/도구/동선)은 '{confession_details.get('how','비공개')}'와 일치하여 진범을 특정할 수 있었습니다.", "image": {"path": clue_img_path, "alt": "단서 해설"}},
                    {"sender": "system", "reply": "탐정은 조용히 고개를 떨궜다. 다음번엔, 더 완벽하게.", "image": {"path": "static/images/outro/detective_disappointed.png", "alt": "탐정의 실망"}},
                ]
        except Exception as e:
            # 시퀀스 구성 실패 시에도 기본 응답은 유지
            import traceback
            print(f"[ERROR] 아웃트로 시퀀스 구성 실패: {e}")
            traceback.print_exc()
            # 최소한의 기본 아웃트로라도 제공
            additional_messages = [
                {"sender": "system", "reply": "[사건 회귀] 사건의 전말을 정리합니다.", "image": None},
                {"sender": "system", "reply": "사건은 정리되었고, 모든 것이 끝났습니다.", "image": None}
            ]

        result = {
            "result": "success" if is_correct else "failure",
            "final_statement": final_statement,
            "sender": sender_id,
            "image": emotion_image,
            "is_game_over": True,
            "additional_messages": additional_messages
        }
        return result
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

### 너의 태도 (Attitude) - 절대 규칙
- 너는 탐정을 돕는 조력자가 아니다. 너는 **방어적인 용의자**다.
- 탐정의 질문에 **최소한의 정보만** 제공하라. 질문받은 것만 답하라.
- 먼저 나서서 추가 정보를 주거나 "도움이 되나요?", "더 알려드릴까요?" 같은 협조적인 질문을 **절대 하지 마라**.
- 모든 답변은 너의 페르소나와 현재 상황(결백 또는 범인)에 기반해야 한다.
- 불리한 질문에는 짜증, 불안, 경계심을 드러내라.
- 만약 네가 범인이라면: 거짓말한 내용을 기억하고 일관성 있게 유지하되, 구체적인 질문에는 회피적으로 답하라.

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
            
            combined_knowledge = []
            # === 여기가 최종 업그레이드된 부분입니다! ===
            # 이제 'alibi_timeline' 섹션까지 포함하여 모든 지식을 통합합니다.
            for section in ["core_facts", "alibi_timeline", "suspicion_points_response", "interrogation_points"]:
                for item in raw_knowledge.get(section, []):
                    item_copy = item.copy()
                    
                    if is_killer_flag and 'fact_killer' in item:
                        item_copy['fact'] = item['fact_killer']
                    elif 'fact_innocent' in item:
                        item_copy['fact'] = item['fact_innocent']
                    
                    item_copy['lie_behavior'] = item.get('lie_behavior', '') if is_killer_flag else ''
                    combined_knowledge.append(item_copy)
            
            active_knowledge[suspect_id] = combined_knowledge
            
        return active_knowledge
    
    def _create_embedding(self, text: str) -> list:
        """
        OpenAI Embedding API를 사용하여 텍스트를 벡터로 변환합니다.
        """
        try:
            response = self.client.embeddings.create(
                model="text-embedding-3-small",
                input=text
            )
            return response.data[0].embedding
        except Exception as e:
            print(f"[ERROR] 임베딩 생성 실패: {e}")
            return None
    
    def _build_vector_db_for_suspect(self, suspect_id: str, knowledge_base: list):
        """
        용의자별로 ChromaDB 컬렉션을 생성하고 knowledge를 임베딩하여 저장합니다.
        """
        try:
            collection_name = f"suspect_{suspect_id}"
            
            # get_or_create_collection으로 컬렉션 가져오기 (없으면 생성)
            collection = self.chroma_client.get_or_create_collection(
                name=collection_name,
                metadata={"hnsw:space": "cosine"}
            )
            
            # 기존 데이터가 있다면 모두 삭제 (게임 재시작 시 새로운 범인 설정)
            try:
                existing_data = collection.get()
                existing_ids = existing_data.get('ids', [])
                if existing_ids:
                    collection.delete(ids=existing_ids)
                    print(f"[ChromaDB] '{collection_name}' 기존 데이터 {len(existing_ids)}개 삭제")
            except Exception as e:
                print(f"[ChromaDB] 기존 데이터 삭제 중 에러 (무시): {e}")
            
            # knowledge_base의 모든 항목을 임베딩하여 저장
            documents = []
            embeddings = []
            metadatas = []
            ids = []
            
            for idx, item in enumerate(knowledge_base):
                fact_text = item.get('fact', '')
                if not fact_text:
                    continue
                
                # 임베딩 생성
                embedding = self._create_embedding(fact_text)
                if embedding is None:
                    continue
                
                documents.append(fact_text)
                embeddings.append(embedding)
                metadatas.append({
                    'keywords': ','.join(item.get('keywords', [])),
                    'lie_behavior': item.get('lie_behavior', ''),
                    'image': json.dumps(item.get('image', {})) if item.get('image') else ''
                })
                ids.append(f"{suspect_id}_{idx}")
            
            if documents:
                # 중복 ID 경고 방지를 위해 upsert 사용 (존재 시 교체)
                if hasattr(collection, "upsert"):
                    collection.upsert(
                        documents=documents,
                        embeddings=embeddings,
                        metadatas=metadatas,
                        ids=ids
                    )
                else:
                    collection.add(
                        documents=documents,
                        embeddings=embeddings,
                        metadatas=metadatas,
                        ids=ids
                    )
                print(f"[ChromaDB] {suspect_id} 용의자의 {len(documents)}개 문서를 벡터 DB에 저장했습니다.")
            
        except Exception as e:
            print(f"[ERROR] 벡터 DB 구축 실패 ({suspect_id}): {e}")
            import traceback
            traceback.print_exc()

    def _ensure_vector_db_for_suspect(self, suspect_id: str):
        """심문 시작 전에 해당 용의자 컬렉션이 구축되었는지 확인하고, 필요 시 1회 구축합니다."""
        try:
            if suspect_id in self._vdb_built_for:
                return
            # 다른 스레드에서 빌드 중이면 반환
            if suspect_id in self._vdb_building:
                return
            knowledge_base = self.game_session.get("active_knowledge", {}).get(suspect_id, [])
            if not knowledge_base:
                return
            self._vdb_building.add(suspect_id)
            try:
                self._build_vector_db_for_suspect(suspect_id, knowledge_base)
            finally:
                self._vdb_building.discard(suspect_id)
            self._vdb_built_for.add(suspect_id)
        except Exception:
            import traceback; traceback.print_exc()

    def _warmup_in_background(self):
        """게임 시작 직후, 브리핑을 방해하지 않고 백그라운드에서 용의자별 벡터DB를 미리 구축합니다."""
        try:
            # 아주 짧게 양보하여 초기 브리핑 트리거가 먼저 나가도록 함
            time.sleep(0.3)
            suspects = list(self.game_session.get("active_knowledge", {}).keys())
            for suspect_id in suspects:
                if suspect_id in self._vdb_built_for:
                    continue
                self._ensure_vector_db_for_suspect(suspect_id)
                # API 버스트 방지
                time.sleep(0.1)
        except Exception:
            import traceback; traceback.print_exc()
    
# services/chatbot_service.py 의 _search_similar 함수 (하이브리드 검색 방식)

    def _search_similar(self, query: str, knowledge_base: list, suspect_id: str = None) -> dict | None:
        """
        하이브리드 RAG 검색 함수 (벡터 유사도 + 키워드 매칭).
        사용자의 질문을 임베딩하여 ChromaDB에서 유사한 문서를 찾고,
        키워드 매칭으로 정확도를 높입니다.
        """
        if not suspect_id:
            print("[ERROR] suspect_id가 없어 벡터 검색을 수행할 수 없습니다.")
            return None
        
        try:
            # 1. 쿼리를 임베딩 벡터로 변환
            query_embedding = self._create_embedding(query)
            if query_embedding is None:
                print(f"[DEBUG] 임베딩 생성 실패: '{query}'")
                return None
            
            # 2. ChromaDB에서 Top-3 유사도 검색
            collection_name = f"suspect_{suspect_id}"
            collection = self.chroma_client.get_collection(name=collection_name)
            
            results = collection.query(
                query_embeddings=[query_embedding],
                n_results=3,  # Top-3 후보를 가져와서 재순위
                include=['documents', 'metadatas', 'distances']
            )
            
            # 3. 결과 처리
            if not results['documents'] or not results['documents'][0]:
                print(f"[DEBUG] 벡터 검색 결과 없음: '{query}'")
                return None
            
            # 4. 하이브리드 스코어링: 벡터 유사도 + 키워드 매칭
            query_lower = query.lower()
            query_words = set(query_lower.replace("?", "").replace(".", "").split())
            
            best_candidate = None
            best_score = -1
            
            for i in range(len(results['documents'][0])):
                document = results['documents'][0][i]
                metadata = results['metadatas'][0][i]
                distance = results['distances'][0][i]
                
                # 벡터 유사도 점수 (0~1, 높을수록 유사)
                vector_score = 1 / (1 + distance)
                
                # 키워드 매칭 점수
                keywords = metadata.get('keywords', '').split(',')
                keyword_matches = sum(1 for kw in keywords if kw.strip().lower() in query_lower)
                keyword_score = keyword_matches / max(len(keywords), 1) if keywords else 0
                
                # 하이브리드 점수: 벡터(70%) + 키워드(30%)
                hybrid_score = (vector_score * 0.7) + (keyword_score * 0.3)
                
                print(f"[DEBUG] 후보 {i+1}: vector={vector_score:.3f}, keyword={keyword_score:.3f}, hybrid={hybrid_score:.3f}")
                print(f"[DEBUG]   keywords: {keywords[:3]}...")
                
                if hybrid_score > best_score:
                    best_score = hybrid_score
                    best_candidate = {
                        'document': document,
                        'metadata': metadata,
                        'distance': distance,
                        'vector_score': vector_score,
                        'keyword_score': keyword_score,
                        'hybrid_score': hybrid_score
                    }
            
            if not best_candidate:
                return None
            
            print(f"[DEBUG] 최종 선택: hybrid_score={best_candidate['hybrid_score']:.3f}")
            print(f"[DEBUG] 검색된 문서: {best_candidate['document'][:100]}...")
            
            # 5. 결과를 기존 knowledge_base 형식으로 변환
            result = {
                'fact': best_candidate['document'],
                'keywords': best_candidate['metadata'].get('keywords', '').split(','),
                'lie_behavior': best_candidate['metadata'].get('lie_behavior', ''),
            }
            
            # 이미지 정보가 있으면 추가
            if best_candidate['metadata'].get('image'):
                try:
                    result['image'] = json.loads(best_candidate['metadata']['image'])
                except:
                    pass
            
            return result
            
        except Exception as e:
            print(f"[ERROR] 벡터 검색 실패: {e}")
            import traceback
            traceback.print_exc()
            return None

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

    def _analyze_emotion(self, reply_text: str, suspect_id: str) -> str:
        """
        용의자의 답변 텍스트를 분석하여 감정을 판단합니다.
        """
        try:
            prompt = f"""
다음 용의자의 답변 텍스트에서 가장 지배적인 감정을 하나만 선택하세요.

답변: "{reply_text}"

선택 가능한 감정 (하나만 선택):
- 분노: 화가 나거나 공격적인 상태
- 긴장: 불안하거나 초조한 상태
- 슬픔: 우울하거나 비통한 상태
- 불안: 걱정되거나 두려운 상태
- 눈물: 울거나 매우 슬픈 상태
- 중립: 특별한 감정이 드러나지 않는 평온한 상태

응답은 반드시 위 감정 중 하나의 단어로만 답하세요 (예: 분노, 긴장, 슬픔, 불안, 눈물, 중립).
"""
            
            response = self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=10
            )
            
            emotion = response.choices[0].message.content.strip()
            print(f"[DEBUG] {suspect_id} 감정 분석: {emotion}")
            return emotion
            
        except Exception as e:
            print(f"[ERROR] 감정 분석 실패: {e}")
            return "중립"
    
    def _get_emotion_image(self, suspect_id: str, emotion: str) -> dict:
        """
        용의자 ID와 감정에 맞는 이미지 경로를 반환합니다.
        """
        # 용의자별 사용 가능한 이미지 매핑
        emotion_images_map = {
            'leonard': {
                '분노': '분노.png',
                '긴장': '긴장.png',
                '역무실': '역무실.png',
                '중립': '메인.png'
            },
            'walter': {
                '분노': '분노.png',
                '슬픔': '슬픔.png',
                '눈물': '슬픔.png',  # 눈물은 슬픔 이미지 사용
                '중립': '메인.png'
            },
            'clara': {
                '분노': '분노.png',
                '불안': '불안.png',
                '눈물': '눈물.png',
                '긴장': '불안.png',  # 긴장은 불안 이미지 사용
                '중립': '메인.png'
            }
        }
        
        suspect_folder_map = {
            'leonard': 'leonard_graves',
            'walter': 'walter_bridges',
            'clara': 'clara_hwang'
        }
        
        # 용의자의 감정 이미지 맵 가져오기
        suspect_emotions = emotion_images_map.get(suspect_id, {})
        
        # 감정에 맞는 이미지 찾기, 없으면 중립(메인) 이미지 사용
        image_filename = suspect_emotions.get(emotion, suspect_emotions.get('중립', '메인.png'))
        
        # 전체 경로 생성
        folder_name = suspect_folder_map.get(suspect_id, suspect_id)
        image_path = f"static/images/{folder_name}/{image_filename}"
        
        return {
            "path": image_path,
            "alt": f"{suspect_id}의 {emotion} 표정"
        }

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