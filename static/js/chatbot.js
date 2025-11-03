// static/js/chatbot.js

document.addEventListener("DOMContentLoaded", () => {
    console.log("챗봇 JS 로드 완료");

    const chatLog = document.getElementById("chat-log");
    const userMessageInput = document.getElementById("user-message");
    const sendBtn = document.getElementById("send-btn");
    const questionsLeftDisplay = document.getElementById("questions-left-display");
    const recoContainer = document.getElementById("recommended-questions-container");
    const suspectTabs = document.querySelectorAll(".suspect-tab");
    const accuseBtn = document.getElementById("accuse-btn");
    const accuseModal = document.getElementById("accuse-modal");
    const suspectSelectBtns = document.querySelectorAll(".suspect-select-btn");

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
        recoContainer.innerHTML = '불러오는 중...';
        try {
            const response = await fetch(`/api/recommendations?suspect_id=${suspectId}`);
            if (!response.ok) throw new Error('Network response was not ok');
            const questions = await response.json();
            
            recoContainer.innerHTML = '';
            questions.forEach(q => {
                const btn = document.createElement('button');
                btn.className = 'reco-btn';
                btn.textContent = q;
                btn.onclick = () => {
                    userMessageInput.value = q;
                    userMessageInput.focus();
                };
                recoContainer.appendChild(btn);
            });
        } catch (err) {
            recoContainer.innerHTML = '추천 질문을 불러오지 못했습니다.';
            console.error("추천 질문 로딩 에러:", err);
        }
    }

    async function sendMessage(isInitial = false) {
        const message = isInitial ? "init" : userMessageInput.value.trim();
        if (!message || isLoading) return;

        if (!isInitial && currentGameMode === 'interrogation' && !currentSuspectId) {
            appendMessage("system", "먼저 심문할 용의자를 선택해주세요.");
            return;
        }

        if (!isInitial) {
            appendMessage("user", message);
            userMessageInput.value = "";
            
        }
        
        setLoading(true);

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: message, suspect_id: currentSuspectId }),
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const data = await response.json();
            handleServerResponse(data);

        } catch (err) {
            console.error("메시지 전송 에러:", err);
            appendMessage("system", "죄송합니다, 서버와 통신 중 오류가 발생했습니다.");
        } finally {
            setLoading(false);
        }
    }

    function handleServerResponse(data) {
        const { reply, sender, questions_left, mode } = data;
        appendMessage(sender || 'bot', reply);
        
        if (mode) {
            currentGameMode = mode;
        }

        if (questions_left !== undefined) {
            updateQuestionsLeftUI(questions_left);
        }
    }
    
    function updateQuestionsLeftUI(count) {
        questionsLeftDisplay.textContent = count;
        if (count <= 5 && count > 0) {
            if(accuseBtn) accuseBtn.style.display = 'block';
        }
        if (count <= 0) {
            userMessageInput.disabled = true;
            userMessageInput.placeholder = "이제 범인을 지목해야 합니다.";
            sendBtn.disabled = true;
            if(accuseBtn) accuseBtn.style.display = 'block';
            if(currentGameMode === 'interrogation' && chatLog.lastChild.textContent.indexOf("모든 질문 기회를 소진했습니다") === -1) {
                 appendMessage("system", "모든 질문 기회를 소진했습니다. 범인을 지목해주십시오.");
            }
        }
    }
    
    async function makeAccusation(accusedId) {
        if(accuseModal) accuseModal.style.display = 'none';
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
            
            userMessageInput.placeholder = "게임이 종료되었습니다. 새로고침하여 다시 시작하세요.";
            if(accuseBtn) accuseBtn.style.display = 'none';

        } catch(err) {
            console.error("범인 지목 에러:", err);
            appendMessage("system", "범인 지목 중 오류가 발생했습니다.");
        } finally {
            setLoading(false);
        }
    }

    function appendMessage(sender, text) {
        const messageElem = document.createElement("div");
        const messageType = (sender === 'user') ? 'user' : 'bot';
        messageElem.classList.add("message", messageType);
        
        if (messageType === 'bot') {
            const senderName = document.createElement('div');
            senderName.className = 'sender-name';
            const displayName = sender.charAt(0).toUpperCase() + sender.slice(1);
            senderName.textContent = displayName;
            messageElem.appendChild(senderName);
        }
        
        const textContainer = document.createElement("div");
        textContainer.innerHTML = text.replace(/\n/g, '<br>');
        messageElem.appendChild(textContainer);

        chatLog.appendChild(messageElem);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    function clearChatLog() {
        chatLog.innerHTML = '';
    }

    function setLoading(status) {
        isLoading = status;
        userMessageInput.disabled = status;
        sendBtn.disabled = status;
        if(accuseBtn) accuseBtn.disabled = status;
    }

    sendBtn.addEventListener("click", () => sendMessage(false));
    userMessageInput.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            sendMessage(false);
        }
    });

    if(accuseBtn) {
        accuseBtn.addEventListener("click", () => {
            if(accuseModal) accuseModal.style.display = 'flex';
        });
    }

    if(suspectSelectBtns) {
        suspectSelectBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                const suspectId = btn.dataset.suspectId;
                makeAccusation(suspectId);
            });
        });
    }

    async function initializeChat() {
        // 1. 서버에 새로운 게임 시작을 요청
        await fetch('/api/start_new_game', { method: 'POST' });
        // 2. 초기 메시지(init)를 보내 Nathan의 브리핑을 받음
        sendMessage(true); 
    }
    
    initializeChat();
});