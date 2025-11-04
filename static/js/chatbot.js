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

<<<<<<< Updated upstream
            clearChatLog();
            appendMessage("system", `${tab.textContent} 심문을 시작합니다.`);
            fetchRecommendedQuestions(suspectId);
=======
      currentSuspectId = suspectId;

      suspectTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      // 해당 용의자의 대화 로그 불러오기
      loadChatLog(suspectId);

      // 대화 로그가 없으면 초기 메시지 표시
      if (!hasChatLog(suspectId)) {
        displaySuspectInfo(suspectId);
        appendMessage("system", `${tab.textContent.trim()} 심문을 시작합니다.`);
      }

      fetchRecommendedQuestions(suspectId);
    });
  });

  async function fetchRecommendedQuestions(suspectId) {
    recoContainer.innerHTML = "불러오는 중...";
    try {
      const response = await fetch(
        `/api/recommendations?suspect_id=${suspectId}`
      );
      if (!response.ok) throw new Error("Network response was not ok");
      const questions = await response.json();

      recoContainer.innerHTML = "";
      questions.forEach((q) => {
        const btn = document.createElement("button");
        btn.className = "reco-btn";
        btn.textContent = q;
        btn.onclick = () => {
          userMessageInput.value = q;
          userMessageInput.focus();
        };
        recoContainer.appendChild(btn);
      });
    } catch (err) {
      recoContainer.innerHTML = "추천 질문을 불러오지 못했습니다.";
      console.error("추천 질문 로딩 에러:", err);
    }
  }

  async function sendMessage(isInitial = false) {
    const message = isInitial ? "init" : userMessageInput.value.trim();
    if (!message || isLoading) return;

    if (
      !isInitial &&
      currentGameMode === "interrogation" &&
      !currentSuspectId
    ) {
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
        body: JSON.stringify({
          message: message,
          suspect_id: currentSuspectId,
        }),
      });

      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      handleServerResponse(data);
    } catch (err) {
      console.error("메시지 전송 에러:", err);
      appendMessage(
        "system",
        "죄송합니다, 서버와 통신 중 오류가 발생했습니다."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleServerResponse(data) {
    const { reply, sender, questions_left, mode } = data;
    appendMessage(sender || "bot", reply);

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
      if (accuseBtn) accuseBtn.style.display = "block";
    }
    if (count <= 0) {
      userMessageInput.disabled = true;
      userMessageInput.placeholder = "이제 범인을 지목해야 합니다.";
      sendBtn.disabled = true;
      if (accuseBtn) accuseBtn.style.display = "block";
      if (
        currentGameMode === "interrogation" &&
        chatLog.lastChild.textContent.indexOf(
          "모든 질문 기회를 소진했습니다"
        ) === -1
      ) {
        appendMessage(
          "system",
          "모든 질문 기회를 소진했습니다. 범인을 지목해주십시오."
        );
      }
    }
  }

  async function makeAccusation(accusedId) {
    if (accuseModal) accuseModal.style.display = "none";
    appendMessage(
      "system",
      `당신은 ${
        accusedId.charAt(0).toUpperCase() + accusedId.slice(1)
      }을(를) 범인으로 지목했습니다...`
    );
    setLoading(true);

    try {
      const response = await fetch("/api/accuse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspect_id: accusedId }),
      });
      const data = await response.json();

      appendMessage(data.sender, data.final_statement);

      if (data.result === "success") {
        appendMessage(
          "system",
          "<b>[사건 해결]</b> 범인을 정확히 찾아냈습니다!"
        );
      } else {
        appendMessage(
          "system",
          "<b>[사건 미궁]</b> 잘못된 지목입니다. 진범은 따로 있었습니다."
        );
      }

      userMessageInput.placeholder =
        "게임이 종료되었습니다. 새로고침하여 다시 시작하세요.";
      if (accuseBtn) accuseBtn.style.display = "none";
    } catch (err) {
      console.error("범인 지목 에러:", err);
      appendMessage("system", "범인 지목 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

function appendMessage(sender, text, imageInfo = null) {
    const messageElem = document.createElement("div");
    const messageType = sender === "user" ? "user" : "bot";
    messageElem.classList.add("message", messageType);

    if (messageType === "user") {
      // 사용자 메시지는 항상 텍스트만 표시합니다.
      messageElem.innerHTML = text.replace(/\n/g, "<br>");
    } else { // 'bot' 메시지 (Nathan, Leonard, system 등 서버로부터 온 모든 응답)
      // 1. 발신자 이름 표시
      const senderName = document.createElement("div");
      senderName.className = "sender-name";
      const displayName = sender.charAt(0).toUpperCase() + sender.slice(1);
      senderName.textContent = displayName;
      messageElem.appendChild(senderName);

      // 2. 범용 이미지 시스템: 서버로부터 이미지 객체가 전달된 경우 이미지를 표시합니다.
      if (imageInfo && imageInfo.path) {
        const img = document.createElement("img");
        img.src = `/${imageInfo.path}`;
        img.alt = imageInfo.alt || "관련 이미지";
        img.style.maxWidth = "100%";
        img.style.borderRadius = "8px";
        img.style.marginBottom = "8px";
        img.style.cursor = "pointer";
        img.onclick = () => window.open(img.src, "_blank");
        messageElem.appendChild(img);
      }

      // 3. 텍스트 내용 추가
      const textContainer = document.createElement("div");
      textContainer.innerHTML = text.replace(/\n/g, "<br>");
      messageElem.appendChild(textContainer);
    }

    chatLog.appendChild(messageElem);
    chatLog.scrollTop = chatLog.scrollHeight;

    // [팀원 코드 반영] 현재 용의자의 대화 로그 저장 (용의자가 선택된 경우에만)
    if (currentSuspectId) {
      // 이미지가 있는 경우, 로그에는 텍스트만 저장하거나 이미지 경로를 포함할 수 있습니다.
      // 여기서는 일단 텍스트만 저장하는 것으로 구현합니다.
      saveChatLog(currentSuspectId, sender, text);
    }
  }

  function clearChatLog() {
    chatLog.innerHTML = "";
  }

  function displaySuspectInfo(suspectId) {
    const suspect = suspectData[suspectId];
    if (!suspect) return;

    const infoCard = document.createElement("div");
    infoCard.className = "suspect-info-card";
    infoCard.innerHTML = `
            <div class="suspect-info-header">
                <img src="${suspect.image}" alt="${suspect.name}" class="suspect-info-image" />
                <div class="suspect-info-details">
                    <div class="suspect-info-name">${suspect.name}</div>
                    <div class="suspect-info-item"><strong>나이:</strong>${suspect.age}</div>
                    <div class="suspect-info-item"><strong>직업:</strong>${suspect.occupationKr}</div>
                </div>
            </div>
            <div class="suspect-info-description">
                ${suspect.description}
            </div>
        `;
    chatLog.appendChild(infoCard);

    // 용의자 정보 카드도 로컬스토리지에 저장
    if (currentSuspectId) {
      saveInfoCard(currentSuspectId);
    }
  }

  // 로컬스토리지 관련 함수들
  function getStorageKey(suspectId) {
    return `chat_log_${suspectId}`;
  }

  function saveChatLog(suspectId, sender, text) {
    try {
      const key = getStorageKey(suspectId);
      let logs = JSON.parse(localStorage.getItem(key) || "[]");

      logs.push({
        sender: sender,
        text: text,
        timestamp: Date.now(),
      });

      localStorage.setItem(key, JSON.stringify(logs));
    } catch (err) {
      console.error("로컬스토리지 저장 에러:", err);
    }
  }

  function saveInfoCard(suspectId) {
    try {
      const key = getStorageKey(suspectId);
      let logs = JSON.parse(localStorage.getItem(key) || "[]");

      // 이미 정보 카드가 저장되어 있는지 확인
      const hasInfoCard = logs.some((log) => log.isInfoCard);
      if (!hasInfoCard) {
        logs.unshift({
          isInfoCard: true,
          suspectId: suspectId,
          timestamp: Date.now(),
>>>>>>> Stashed changes
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