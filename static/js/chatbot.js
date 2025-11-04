// static/js/chatbot.js

document.addEventListener("DOMContentLoaded", () => {
  console.log("챗봇 JS 로드 완료");

  const chatLog = document.getElementById("chat-log");
  const userMessageInput = document.getElementById("user-message");
  const sendBtn = document.getElementById("send-btn");
  const questionsLeftDisplay = document.getElementById(
    "questions-left-display"
  );
  const recoContainer = document.getElementById(
    "recommended-questions-container"
  );
  const suspectTabs = document.querySelectorAll(".suspect-tab");
  const accuseBtn = document.getElementById("accuse-btn");
  const accuseModal = document.getElementById("accuse-modal");
  const suspectSelectBtns = document.querySelectorAll(".suspect-select-btn");

  let currentSuspectId = null;
  let isLoading = false;
  let currentGameMode = "briefing";

  // 용의자 정보 데이터
  const suspectData = {
    leonard: {
      name: "Leonard Graves",
      koreanName: "레너드 그레이브스",
      age: "52세",
      occupation: "Station Attendant / Night Supervisor",
      occupationKr: "할로슬랍 스테이션 야간 역무원",
      image: "https://picsum.photos/seed/leonard/200/300",
      description:
        "30년째 할로슬랍 스테이션에서 근무 중인 베테랑 역무원. 철도청 구조조정으로 이번 달 말 퇴직 예정. 성실하고 과묵하지만 과거에 집착하는 완벽주의자로, 역을 '자신의 마지막 집'처럼 여기고 있다.",
    },
    walter: {
      name: "Walter Briggs",
      koreanName: "월터 브릭스",
      age: "68세",
      occupation: "Former Train Engineer",
      occupationKr: "전직 기관사 / 현재 노숙자",
      image: "https://picsum.photos/seed/walter/200/300",
      description:
        "할로슬랍 스테이션에서 15년간 근무한 전직 기관사. 10년 전 사고의 책임을 떠안고 조기 퇴직 후, 교통사고로 가족을 잃고 삶이 붕괴. 현재는 역 근처 대합실에서 지내며 지역 사람들 사이에서 '역의 유령'이라 불린다.",
    },
    clara: {
      name: "Clara Hwang",
      koreanName: "클라라 황",
      age: "26세",
      occupation: "Caregiver",
      occupationKr: "간병인 (시내 종합병원 야간 근무)",
      image: "https://picsum.photos/seed/clara/200/300",
      description:
        "홀어머니와 함께 외곽 마을에서 거주하며 도심 병원에서 야간 근무 중. 항상 밤 11시 30분 막차를 타고 귀가하는 할로슬랍 스테이션의 단골 통근자. 조용하고 성실한 이미지.",
    },
  };

  suspectTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (isLoading) return;
      const suspectId = tab.dataset.suspectId;
      if (currentSuspectId === suspectId) return;

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
    // 서버 응답에서 'image' 객체를 추출합니다.
    const { reply, sender, questions_left, mode, image } = data;
    // appendMessage에 'image' 객체를 세 번째 인자로 전달합니다.
    appendMessage(sender || "bot", reply, image);

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
    // (1차 업그레이드 내용은 모두 동일)
    const messageElem = document.createElement("div");
    const messageType = sender === "user" ? "user" : "bot";
    messageElem.classList.add("message", messageType);

    if (messageType === "user") {
      messageElem.innerHTML = text.replace(/\n/g, "<br>");
    } else {
      const senderName = document.createElement("div");
      senderName.className = "sender-name";
      const displayName = sender.charAt(0).toUpperCase() + sender.slice(1);
      senderName.textContent = displayName;
      messageElem.appendChild(senderName);

      if (imageInfo && imageInfo.path) {
        const img = document.createElement("img");
        img.src = `/${imageInfo.path}`;
        img.alt = imageInfo.alt || "관련 이미지";
        img.style.maxWidth = "100%";
                
        img.style.maxHeight = "400px"; // 이미지의 최대 높이를 400px로 제한합니다.
        img.style.objectFit = "contain"; // 이미지가 비율을 유지하며 컨테이너 안에 맞춰지도록 설정합니다.
        
        img.style.borderRadius = "8px";
        img.style.marginBottom = "8px";
        img.style.cursor = "pointer";
        img.onclick = () => window.open(img.src, "_blank");
        messageElem.appendChild(img);
      }

      const textContainer = document.createElement("div");
      textContainer.innerHTML = text.replace(/\n/g, "<br>");
      messageElem.appendChild(textContainer);
    }

    chatLog.appendChild(messageElem);
    chatLog.scrollTop = chatLog.scrollHeight;

    // [2차 업그레이드 핵심] 팀원의 대화 로그 저장 기능을 여기에 추가.
    if (currentSuspectId) {
      saveChatLog(currentSuspectId, sender, text, imageInfo);
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

  function saveChatLog(suspectId, sender, text, imageInfo = null) {
    try {
      const key = getStorageKey(suspectId);
      let logs = JSON.parse(localStorage.getItem(key) || "[]");

      logs.push({
        sender: sender,
        text: text,
        imageInfo: imageInfo,
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
        });
        localStorage.setItem(key, JSON.stringify(logs));
      }
    } catch (err) {
      console.error("로컬스토리지 저장 에러:", err);
    }
  }

  function loadChatLog(suspectId) {
    try {
      chatLog.innerHTML = ""; // 화면 초기화

      const key = getStorageKey(suspectId);
      const logs = JSON.parse(localStorage.getItem(key) || "[]");

      if (logs.length === 0) {
        return; // 로그가 없으면 빈 화면
      }

      logs.forEach((log) => {
        if (log.isInfoCard) {
          // 용의자 정보 카드 복원
          displaySuspectInfoWithoutSave(log.suspectId);
        } else {
          // 일반 메시지 복원 (이미지 정보 포함)
          appendMessageWithoutSave(log.sender, log.text, log.imageInfo);
        }
      });

      chatLog.scrollTop = chatLog.scrollHeight;
    } catch (err) {
      console.error("로컬스토리지 로드 에러:", err);
    }
  }

  function hasChatLog(suspectId) {
    try {
      const key = getStorageKey(suspectId);
      const logs = JSON.parse(localStorage.getItem(key) || "[]");
      return logs.length > 0;
    } catch (err) {
      return false;
    }
  }

  function displaySuspectInfoWithoutSave(suspectId) {
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
  }

  function appendMessageWithoutSave(sender, text, imageInfo = null) {
    const messageElem = document.createElement("div");
    const messageType = sender === "user" ? "user" : "bot";
    messageElem.classList.add("message", messageType);

    if (messageType === "user") {
      messageElem.innerHTML = text.replace(/\n/g, "<br>");
    } else {
      const senderName = document.createElement("div");
      senderName.className = "sender-name";
      const displayName = sender.charAt(0).toUpperCase() + sender.slice(1);
      senderName.textContent = displayName;
      messageElem.appendChild(senderName);

      // 이미지가 있으면 복원
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

      const textContainer = document.createElement("div");
      textContainer.innerHTML = text.replace(/\n/g, "<br>");
      messageElem.appendChild(textContainer);
    }

    chatLog.appendChild(messageElem);
  }

  function clearAllChatLogs() {
    try {
      Object.keys(suspectData).forEach((suspectId) => {
        const key = getStorageKey(suspectId);
        localStorage.removeItem(key);
      });
      console.log("모든 대화 로그가 초기화되었습니다.");
    } catch (err) {
      console.error("로컬스토리지 초기화 에러:", err);
    }
  }

  function setLoading(status) {
    isLoading = status;
    userMessageInput.disabled = status;
    sendBtn.disabled = status;
    if (accuseBtn) accuseBtn.disabled = status;
  }

  sendBtn.addEventListener("click", () => sendMessage(false));
  userMessageInput.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage(false);
    }
  });

  if (accuseBtn) {
    accuseBtn.addEventListener("click", () => {
      if (accuseModal) accuseModal.style.display = "flex";
    });
  }

  if (suspectSelectBtns) {
    suspectSelectBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const suspectId = btn.dataset.suspectId;
        makeAccusation(suspectId);
      });
    });
  }

  async function initializeChat() {
    // 1. 모든 용의자의 대화 로그 초기화 (새 게임 시작)
    clearAllChatLogs();

    // 2. 서버에 새로운 게임 시작을 요청
    await fetch("/api/start_new_game", { method: "POST" });

    // 3. 초기 메시지(init)를 보내 Nathan의 브리핑을 받음
    sendMessage(true);
  }

  initializeChat();
});