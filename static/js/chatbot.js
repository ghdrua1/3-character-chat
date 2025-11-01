console.log("챗봇 JS 로드 완료");

// DOM 요소
const chatArea = document.querySelector(".chat-area");
const username = chatArea ? chatArea.dataset.username : "사용자";
const chatLog = document.getElementById("chat-log");
const userMessageInput = document.getElementById("user-message");
const sendBtn = document.getElementById("send-btn");
const videoBtn = document.getElementById("videoBtn");
const imageBtn = document.getElementById("imageBtn");

// 현재 선택된 용의자 ID (나중에 UI와 연동)
// 우선 테스트를 위해 기본값으로 'leonard'를 설정해두거나,
// 혹은 UI가 구현되기 전까지는 하드코딩하여 테스트할 수 있습니다.
let currentSuspectId = null; // 초기에는 아무도 선택되지 않음

// ========================================================================
// === 이 부분은 나중에 용의자 탭 UI를 만들 때 연동할 로직의 예시입니다. ===
// === 지금은 그냥 참고용으로만 보세요.                           ===
// document.getElementById('leonard-tab').addEventListener('click', () => {
//   currentSuspectId = 'leonard';
//   console.log('심문 대상 변경: Leonard');
// });
// document.getElementById('walter-tab').addEventListener('click', () => {
//   currentSuspectId = 'walter';
//   console.log('심문 대상 변경: Walter');
// });
// document.getElementById('clara-tab').addEventListener('click', () => {
//   currentSuspectId = 'clara';
//   console.log('심문 대상 변경: Clara');
// });
// ========================================================================


// 메시지 전송 함수
async function sendMessage(isInitial = false) {
  let message;

  if (isInitial) {
    message = "init";
  } else {
    message = userMessageInput.value.trim();
    if (!message) return;

    appendMessage("user", message);
    userMessageInput.value = "";
  }

  // 로딩 표시
  const loadingId = appendMessage("bot", "생각 중...");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message,
        username: username,
        // 현재 선택된 용의자 ID를 함께 전송합니다.
        // UI가 없으므로 임시로 'leonard'를 하드코딩하여 테스트 해보세요.
        // 또는, 심문 모드가 아닐 때를 위해 null로 보낼 수 있습니다.
        suspect_id: currentSuspectId 
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // 로딩 메시지 제거
    removeMessage(loadingId);

    // =====================================================
    // === 여기가 핵심 수정 부분입니다! (응답 파싱 로직) ===
    // =====================================================
    const replyText = data.reply;
    const imagePath = data.image || null;
    const sender = data.sender || 'bot'; // 'nathan', 'leonard' 등 서버가 보내주는 sender

    appendMessage(sender, replyText, imagePath);

  } catch (err) {
    console.error("메시지 전송 에러:", err);
    removeMessage(loadingId);
    appendMessage("bot", "죄송합니다. 오류가 발생했습니다. 다시 시도해주세요.");
  }
}

// 메시지 DOM에 추가
let messageIdCounter = 0;
function appendMessage(sender, text, imageSrc = null) {
  const messageId = `msg-${messageIdCounter++}`;
  const messageElem = document.createElement("div");

  // 'user'가 아니면 모두 'bot' 스타일을 기본으로 적용
  const messageType = (sender === 'user') ? 'user' : 'bot';
  messageElem.classList.add("message", messageType);
  messageElem.id = messageId;
  
  // ================================================================
  // === 여기가 핵심 수정 부분입니다! (보낸 사람 이름 표시 로직) ===
  // ================================================================
  // 'user'가 아닌 경우, 보낸 사람(nathan, leonard 등)의 이름을 표시
  if (messageType === 'bot') {
      const senderName = document.createElement('div');
      senderName.style.fontWeight = 'bold';
      senderName.style.marginBottom = '5px';
      senderName.style.fontSize = '0.9em';
      senderName.style.color = '#555';
      
      // sender id를 보기 좋게 변환 (예: 'nathan' -> 'Nathan')
      const displayName = sender.charAt(0).toUpperCase() + sender.slice(1);
      senderName.textContent = displayName;
      
      messageElem.appendChild(senderName);
  }

  // 이미지가 있으면 먼저 표시
  if (imageSrc) {
    const botImg = document.createElement("img");
    botImg.classList.add("bot-big-img");
    botImg.src = imageSrc;
    botImg.alt = "챗봇 이미지";
    messageElem.appendChild(botImg);
  }

  // 텍스트 추가 (줄바꿈을 <br>로 변환)
  const textContainer = document.createElement("div");
  textContainer.classList.add("bot-text-container");
  textContainer.innerHTML = text.replace(/\n/g, '<br>'); // \n을 <br> 태그로 변경
  messageElem.appendChild(textContainer);

  if (chatLog) {
    chatLog.appendChild(messageElem);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  return messageId;
}

// 메시지 제거
function removeMessage(messageId) {
  const elem = document.getElementById(messageId);
  if (elem) {
    elem.remove();
  }
}

// 엔터키로 전송
if (userMessageInput) {
  userMessageInput.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault(); // form 전송 방지
      sendMessage();
    }
  });
}

// 전송 버튼
if (sendBtn) {
  sendBtn.addEventListener("click", () => sendMessage());
}

// 모달 열기/닫기
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = "block";
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = "none";
  }
}

// 미디어 버튼 이벤트
if (videoBtn) {
  videoBtn.addEventListener("click", () => openModal("videoModal"));
}

if (imageBtn) {
  imageBtn.addEventListener("click", () => openModal("imageModal"));
}

// 모달 닫기 버튼
document.querySelectorAll(".modal-close").forEach((btn) => {
  btn.addEventListener("click", () => {
    const modalId = btn.dataset.closeModal;
    closeModal(modalId);
  });
});

// 모달 배경 클릭 시 닫기
document.querySelectorAll(".modal").forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  });
});

// 페이지 로드 시 초기 메시지 요청
window.addEventListener("load", () => {
  console.log("페이지 로드 완료. 0.5초 후 초기 메시지를 요청합니다.");

  setTimeout(() => {
    // 채팅 기록이 비어있을 때만 초기 메시지 요청
    if (chatLog && chatLog.childElementCount === 0) {
      console.log("초기 메시지 요청 실행");
      sendMessage(true);
    }
  }, 500);
});