// static/js/chatbot.js

document.addEventListener("DOMContentLoaded", () => {
    console.log("챗봇 JS 로드 완료");

    const chatLog = document.getElementById("chat-log");
    const userMessageInput = document.getElementById("user-message");
    const sendBtn = document.getElementById("send-btn");
    const questionsLeftDisplay = document.getElementById("questions-left-display");
    const recoContainer = document.getElementById("recommended-questions-container");
    const suspectTabs = document.querySelectorAll(".suspect-tab");
    
    // === [STEP 4] 변경점: 새로운 UI 요소들 가져오기 ===
    const accuseBtn = document.getElementById("accuse-btn");
    const accuseModal = document.getElementById("accuse-modal");
    const suspectSelectBtns = document.querySelectorAll(".suspect-select-btn");
    // =================================================

    let currentSuspectId = null;
    let isLoading = false;
    let currentGameMode = 'briefing'; 

    suspectTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            if (isLoading) return;
            const suspectId = tab.dataset.suspectId;
            if (currentSuspectId === suspectId) return;
            currentSuspectId = suspectId;
            suspectTabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            clearChatLog();
            appendMessage("system", `${tab.textContent} 심문을 시작합니다.`);
            fetchRecommendedQuestions(suspectId);
        });
    });

    async function fetchRecommendedQuestions(suspectId) {
        // (이전과 동일)
        // ...
    }

    async function sendMessage(isInitial = false) {
        // (이전과 동일)
        // ...
    }

    function handleServerResponse(data) {
        const { reply, sender, questions_left, mode } = data;
        appendMessage(sender || 'bot', reply);
        if (mode) { currentGameMode = mode; }
        if (questions_left !== undefined) { updateQuestionsLeft(questions_left); }
    }
    
    function updateQuestionsLeft(count) {
        questionsLeftDisplay.textContent = count;
        // === [STEP 4] 변경점: 범인 지목 버튼 활성화 로직 ===
        if (count <= 5 && count > 0) {
            accuseBtn.style.display = 'block';
        }
        // ===============================================
        if (count <= 0) {
            userMessageInput.disabled = true;
            userMessageInput.placeholder = "이제 범인을 지목해야 합니다.";
            sendBtn.disabled = true;
            accuseBtn.style.display = 'block';
            appendMessage("system", "모든 질문 기회를 소진했습니다. 범인을 지목해주십시오.");
        }
    }
    
    // === [STEP 4] 변경점: 범인 지목 로직 함수 추가 ===
    async function makeAccusation(accusedId) {
        accuseModal.style.display = 'none';
        appendMessage("system", `당신은 ${accusedId.charAt(0).toUpperCase() + accusedId.slice(1)}을(를) 범인으로 지목했습니다...`);
        setLoading(true);

        try {
            const response = await fetch('/api/accuse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ suspect_id: accusedId })
            });
            const data = await response.json();
            
            appendMessage(data.sender, data.final_statement);

            if(data.result === 'success') {
                appendMessage("system", "<b>[사건 해결]</b> 범인을 정확히 찾아냈습니다!");
            } else {
                appendMessage("system", "<b>[사건 미궁]</b> 잘못된 지목입니다. 진범은 따로 있었습니다.");
            }
            
            // 게임 종료 처리
            userMessageInput.placeholder = "게임이 종료되었습니다.";
            accuseBtn.style.display = 'none';

        } catch(err) {
            console.error("범인 지목 에러:", err);
            appendMessage("system", "범인 지목 중 오류가 발생했습니다.");
        } finally {
            setLoading(false);
        }
    }
    // ========================================================

    function appendMessage(sender, text) { /* (이전과 동일) */ }
    function clearChatLog() { /* (이전과 동일) */ }
    function setLoading(status) {
        isLoading = status;
        userMessageInput.disabled = status;
        sendBtn.disabled = status;
        accuseBtn.disabled = status; // 지목 중에는 버튼 비활성화
    }

    sendBtn.addEventListener("click", () => sendMessage(false));
    userMessageInput.addEventListener("keypress", (event) => {
        if (event.key === "Enter") { event.preventDefault(); sendMessage(false); }
    });

    // === [STEP 4] 변경점: 범인 지목 버튼 및 모달 이벤트 리스너 추가 ===
    accuseBtn.addEventListener("click", () => {
        accuseModal.style.display = 'flex';
    });

    suspectSelectBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const suspectId = btn.dataset.suspectId;
            makeAccusation(suspectId);
        });
    });
    // ==============================================================

    async function initializeChat() {
        await fetch('/api/start_new_game', { method: 'POST' });
        sendMessage(true); 
    }
    
    initializeChat();

    // (Helper 함수들의 실제 내용은 이전 답변의 전체 코드를 참고하여 채워넣으시면 됩니다)
    function fetchRecommendedQuestions(suspectId) { recoContainer.innerHTML = '불러오는 중...'; fetch(`/api/recommendations?suspect_id=${suspectId}`).then(res => res.json()).then(questions => { recoContainer.innerHTML = ''; questions.forEach(q => { const btn = document.createElement('button'); btn.className = 'reco-btn'; btn.textContent = q; btn.onclick = () => { userMessageInput.value = q; userMessageInput.focus(); }; recoContainer.appendChild(btn); }); }).catch(err => { recoContainer.innerHTML = '추천 질문을 불러오지 못했습니다.'; console.error("추천 질문 로딩 에러:", err); }); }
    function sendMessage(isInitial = false) { const message = isInitial ? "init" : userMessageInput.value.trim(); if (!message || isLoading) return; if (!isInitial && currentGameMode === 'interrogation' && !currentSuspectId) { appendMessage("system", "먼저 심문할 용의자를 선택해주세요."); return; } if (!isInitial) { appendMessage("user", message); userMessageInput.value = ""; } setLoading(true); fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: message, suspect_id: currentSuspectId }), }).then(res => { if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`); return res.json(); }).then(data => handleServerResponse(data)).catch(err => { console.error("메시지 전송 에러:", err); appendMessage("system", "죄송합니다, 서버와 통신 중 오류가 발생했습니다."); }).finally(() => setLoading(false)); }
    function appendMessage(sender, text) { const messageElem = document.createElement("div"); const messageType = (sender === 'user') ? 'user' : 'bot'; messageElem.classList.add("message", messageType); if (messageType === 'bot') { const senderName = document.createElement('div'); senderName.className = 'sender-name'; const displayName = sender.charAt(0).toUpperCase() + sender.slice(1); senderName.textContent = displayName; messageElem.appendChild(senderName); } const textContainer = document.createElement("div"); textContainer.innerHTML = text.replace(/\n/g, '<br>'); messageElem.appendChild(textContainer); chatLog.appendChild(messageElem); chatLog.scrollTop = chatLog.scrollHeight; }
    function clearChatLog() { chatLog.innerHTML = ''; }
});