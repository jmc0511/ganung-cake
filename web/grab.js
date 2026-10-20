// 북마클릿 본문. 아무 검색 페이지에서 실행되어 이미지 위에 '케이크에 꽂기' 버튼을 띄운다.
// 누르면 이 사이트의 relay.html을 작은 창으로 열어 이미지 주소를 넘기고, relay가 BroadcastChannel로
// 케이크 탭에 전달한 뒤 스스로 닫힌다. (구글 등은 COOP로 window.opener를 끊어서 opener를 못 씀)
// 이 함수는 toString()으로 javascript: 주소가 되므로 바깥 변수를 참조하면 안 된다. __RELAY__는 생성 시 치환된다.
function ganungCakeBookmarklet() {
  if (window.__ganungCake) { window.__ganungCake.flash('이미 켜져 있어요'); return; }
  var MIN = 56, current = null, hideTimer = 0, raf = 0;
  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0 auto auto 0;z-index:2147483647;pointer-events:none;';
  var root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = '<style>' +
    'button,.tip{position:fixed;pointer-events:auto;font:700 13px/1 "Malgun Gothic","Apple SD Gothic Neo",sans-serif;border-radius:999px;box-shadow:0 3px 10px rgba(60,10,30,.35)}' +
    'button{display:none;cursor:pointer;padding:9px 13px;border:2px solid #fff;background:#D93A64;color:#fff;white-space:nowrap}' +
    'button:hover{background:#B82A51}button.done{background:#2F8F5B}' +
    '.tip{left:50%;top:14px;transform:translateX(-50%);padding:10px 16px;background:#3A1E29;color:#fff;transition:opacity .3s;pointer-events:none}' +
    '</style><button type="button">케이크에 꽂기</button><div class="tip"></div>';
  var btn = root.querySelector('button'), tip = root.querySelector('.tip');
  document.documentElement.appendChild(host);

  function flash(msg) {
    tip.textContent = msg; tip.style.opacity = '1';
    clearTimeout(flash.t); flash.t = setTimeout(function () { tip.style.opacity = '0'; }, 2600);
  }
  window.__ganungCake = { flash: flash };
  flash('이미지에 마우스를 올려 케이크에 꽂으세요');

  function findImg(x, y) {
    var els = document.elementsFromPoint(x, y);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el === host) return 'btn';
      if (el.tagName === 'IMG') {
        var r = el.getBoundingClientRect();
        if (r.width >= MIN && r.height >= MIN) return el;
      }
    }
    return null;
  }
  function show(img) {
    current = img;
    var r = img.getBoundingClientRect();
    btn.textContent = '케이크에 꽂기'; btn.className = '';
    btn.style.display = 'block';
    var bw = btn.offsetWidth;
    btn.style.left = Math.max(4, Math.min(innerWidth - bw - 4, r.right - bw - 8)) + 'px';
    btn.style.top = Math.max(4, r.top + 8) + 'px';
  }
  function hideSoon(ms) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { btn.style.display = 'none'; current = null; }, ms || 250);
  }
  function best(img) {
    if (img.srcset) {
      var bestU = null, bestW = 0;
      img.srcset.split(',').forEach(function (p) {
        var a = p.trim().split(/\s+/), w = parseFloat(a[1]) || 1;
        if (a[0] && w > bestW) { bestU = a[0]; bestW = w; }
      });
      if (bestU) return new URL(bestU, location.href).href;
    }
    return img.currentSrc || img.src;
  }
  document.addEventListener('mousemove', function (e) {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      var hit = findImg(e.clientX, e.clientY);
      if (hit === 'btn') return clearTimeout(hideTimer);
      if (hit) { clearTimeout(hideTimer); if (hit !== current || btn.style.display === 'none') show(hit); }
      else if (current) hideSoon();
    });
  }, true);
  addEventListener('scroll', function () { btn.style.display = 'none'; current = null; }, true);
  btn.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
  btn.addEventListener('click', function (e) {
    e.preventDefault(); e.stopPropagation();
    if (!current) return;
    var w = Math.round(screenX + outerWidth - 340), h = Math.round(screenY + 80);
    var relay = window.open('__RELAY__#' + encodeURIComponent(best(current)), 'ganung-cake-relay', 'popup,width=300,height=120,left=' + w + ',top=' + h);
    if (!relay) { flash('팝업이 막혔어요. 주소창의 팝업 허용을 눌러주세요'); return; }
    btn.textContent = '꽂았어요'; btn.className = 'done';
    hideSoon(900);
  }, true);
}
