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

  // 탭별 고유 ID 생성 (sessionStorage 사용 - 탭별로 독립적)
  let tabSessionId = sessionStorage.getItem('tab_session_id');
  if (!tabSessionId) {
    tabSessionId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('tab_session_id', tabSessionId);
  }
  console.log('[탭 세션 ID]', tabSessionId);

  let currentSuspectId = null;
  let isLoading = false;
  let currentGameMode = "briefing";
  // 아웃트로 대기열: 지목 후 사용자가 '사건 회귀'라고 말하면 재생
  let pendingOutro = null;

  // 용의자 정보 데이터
  const suspectData = {
    leonard: {
      name: "Leonard Graves",
      koreanName: "레너드 그레이브스",
      age: "52세",
      occupation: "Station Attendant / Night Supervisor",
      occupationKr: "할로슬랍 스테이션 야간 역무원",
      image: "/static/images/leonard_graves/메인.png",
      description:
        "30년째 할로슬랍 스테이션에서 근무 중인 베테랑 역무원. 철도청 구조조정으로 이번 달 말 퇴직 예정. 성실하고 과묵하지만 과거에 집착하는 완벽주의자로, 역을 '자신의 마지막 집'처럼 여기고 있다.",
    },
    walter: {
      name: "Walter Briggs",
      koreanName: "월터 브릭스",
      age: "68세",
      occupation: "Former Train Engineer",
      occupationKr: "전직 기관사 / 현재 노숙자",
      image: "/static/images/walter_bridges/메인.png",
      description:
        "할로슬랍 스테이션에서 15년간 근무한 전직 기관사. 10년 전 사고의 책임을 떠안고 조기 퇴직 후, 교통사고로 가족을 잃고 삶이 붕괴. 현재는 역 근처 대합실에서 지내며 지역 사람들 사이에서 '역의 유령'이라 불린다.",
    },
    clara: {
      name: "Clara Hwang",
      koreanName: "클라라 황",
      age: "26세",
      occupation: "Caregiver",
      occupationKr: "간병인 (시내 종합병원 야간 근무)",
      image: "/static/images/clara_hwang/메인.png",
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

      // Nathan 탭인 경우 특별 처리
      if (suspectId === "nathan") {
        loadNathanLog();
        recoContainer.innerHTML =
          "<p style='color: #ccc; padding: 10px;'>수사 기록을 확인하고 있습니다.</p>";
        return;
      }

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
        headers: { 
          "Content-Type": "application/json",
          "X-Tab-Session-ID": tabSessionId  // 탭별 세션 ID 전송
        },
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
        "죄송합니다, 서버와 통신 중 오류가 발생했습니다. 새로고침하여 다시 시도해주세요."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleServerResponse(data) {
    const {
      reply,
      sender,
      image,
      messages,
      additional_messages,
      questions_left,
      mode,
    } = data;

    // 순차 연출이 필요한 경우 (초기 브리핑)
    if (messages && Array.isArray(messages)) {
      setLoading(true);
      for (const msg of messages) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        appendMessage(msg.sender, msg.reply, msg.image);
      }
      setLoading(false);
    }
    // [핵심 수정] 일반적인 단일 메시지 응답의 경우 (용의자 답변)
    else if (reply) {
      // async/await 없이 즉시 appendMessage를 호출합니다.
      appendMessage(sender, reply, image);
    }

    // 중간 보고는 위와 독립적으로, 추가적으로 순차 연출이 필요합니다.
    if (additional_messages && Array.isArray(additional_messages)) {
      setLoading(true);
      for (const msg of additional_messages) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        appendMessage(msg.sender, msg.reply, msg.image);
      }
      setLoading(false);
    }

    // 공통 상태 업데이트는 모든 경우에 마지막으로 실행됩니다.
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
      }을(를) 범인으로 지목했습니다...`,
      { path: "static/images/adrian_vale/고민.png", alt: "탐정의 고민" }
    );
    setLoading(true);

    try {
      const response = await fetch("/api/accuse", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-Tab-Session-ID": tabSessionId  // 탭별 세션 ID 전송
        },
        body: JSON.stringify({ suspect_id: accusedId }),
      });
      const data = await response.json();

      // 1) 지목당한 인물의 심정 토로/자백/반박 먼저 출력
      appendMessage(data.sender, data.final_statement, data.image);

      // 2) 성공/실패 문구 출력 (실패 시 탐정 실망 이미지 포함)
      if (data.result === "success") {
        appendMessage(
          "system",
          "<b>[사건 해결]</b> 범인을 정확히 찾아냈습니다!"
        );
      } else {
        appendMessage(
          "system",
          "<b>[사건 미궁]</b> 잘못된 지목입니다. 진범은 따로 있었습니다.",
          { path: "static/images/outro/detective_disappointed.png", alt: "탐정의 실망" }
        );
      }

      // 3) 10초 후 아웃트로 자동 재생
      if (data.additional_messages && Array.isArray(data.additional_messages) && data.additional_messages.length > 0) {
        setTimeout(async () => {
          setLoading(true);
          try {
            for (let i = 0; i < data.additional_messages.length; i++) {
              const msg = data.additional_messages[i];
              await new Promise((resolve) => setTimeout(resolve, 4500));
              const msgText = msg.reply || msg.text || "";
              const msgImage = msg.image || null;
              appendMessage(msg.sender || "system", msgText, msgImage);
            }
          } catch (err) {
            console.error("[아웃트로] 재생 중 오류:", err);
          } finally {
            setLoading(false);
          }
        }, 10000); // 10초 대기
      }

      userMessageInput.placeholder =
        "게임이 종료되었습니다. 새로운 게임을 원하시면 새로운 탭에서 다시 시작하거나 강력새로고침하세요. (Ctrl + Shift + R)";
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
    // --- [핵심 수정] ---
    // '띡' 내려가는 대신, 부드럽게 스크롤되도록 변경합니다.
    chatLog.scrollTo({
      top: chatLog.scrollHeight,
      behavior: "smooth",
    });
    // --------------------

    // Nathan/System 메시지는 항상 수사 기록에 저장
    if (sender === "nathan" || sender === "system") {
      saveNathanLog(sender, text, imageInfo);
    }

    // [2차 업그레이드 핵심] 팀원의 대화 로그 저장 기능을 여기에 추가.
    if (currentSuspectId && currentSuspectId !== "nathan") {
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
      // Nathan 로그도 초기화
      localStorage.removeItem("chat_log_nathan");
      console.log("모든 대화 로그가 초기화되었습니다.");
    } catch (err) {
      console.error("로컬스토리지 초기화 에러:", err);
    }
  }

  // Nathan 수사 기록 전용 함수들
  function saveNathanLog(sender, text, imageInfo = null) {
    try {
      const key = "chat_log_nathan";
      let logs = JSON.parse(localStorage.getItem(key) || "[]");

      logs.push({
        sender: sender,
        text: text,
        imageInfo: imageInfo,
        timestamp: Date.now(),
      });

      localStorage.setItem(key, JSON.stringify(logs));
    } catch (err) {
      console.error("Nathan 로그 저장 에러:", err);
    }
  }

  function loadNathanLog() {
    try {
      chatLog.innerHTML = ""; // 화면 초기화

      const key = "chat_log_nathan";
      const logs = JSON.parse(localStorage.getItem(key) || "[]");

      if (logs.length === 0) {
        chatLog.innerHTML =
          "<div style='color: #ccc; padding: 20px; text-align: center;'>아직 수사 기록이 없습니다.</div>";
        return;
      }

      logs.forEach((log) => {
        appendMessageWithoutSave(log.sender, log.text, log.imageInfo);
      });

      chatLog.scrollTop = chatLog.scrollHeight;
    } catch (err) {
      console.error("Nathan 로그 로드 에러:", err);
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

    // 2. 서버에 새로운 게임 시작을 요청 (대기하지 않고 비동기 전송)
    fetch("/api/start_new_game", { 
      method: "POST",
      headers: {
        "X-Tab-Session-ID": tabSessionId  // 탭별 세션 ID 전송
      }
    }).catch(() => {});

    // 3. Nathan 탭을 기본으로 활성화
    currentSuspectId = "nathan";
    const nathanTab = document.querySelector('[data-suspect-id="nathan"]');
    if (nathanTab) {
      nathanTab.classList.add("active");
    }

    // 4. 초기 메시지(init)를 보내 Nathan의 브리핑을 받음 (즉시 시작)
    sendMessage(true);
  }

  initializeChat();
});
