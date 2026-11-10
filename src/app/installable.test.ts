/** 홈 화면 추가(전체 화면 실행) 설정 검사: manifest·index.html·아이콘 파일 */
import manifestText from '../../public/manifest.webmanifest?raw';
import html from '../../index.html?raw';

const manifest = JSON.parse(manifestText);

// public/icons/*.png 를 data URL 로 읽어 둔다 (키: /icons/파일명)
const iconFiles = import.meta.glob<string>('../../public/icons/*.png', { query: '?inline', import: 'default', eager: true });
const icons = Object.fromEntries(Object.entries(iconFiles).map(([k, v]) => [k.replace('../../public', ''), v]));

/** PNG 헤더(IHDR)에서 가로·세로 읽기 */
function pngSize(publicPath: string): [number, number] {
  const dataUrl = icons[publicPath];
  expect(dataUrl, publicPath).toBeDefined();
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  expect(bin.slice(1, 4)).toBe('PNG');
  const view = new DataView(bytes.buffer);
  return [view.getUint32(16), view.getUint32(20)];
}

describe('manifest', () => {
  it('이름·실행 방식·주소·방향·색', () => {
    expect(manifest).toMatchObject({
      name: '반반',
      short_name: '반반',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      orientation: 'any', // 도토리 열 알(가로 전용) 때문에 세로 고정 금지 (BANB-58)
      theme_color: '#FFFFFF', // index.html meta theme-color와 같게(흰 상단바)
      background_color: '#FFFFFF',
    });
  });

  it('192·512 아이콘(any)과 maskable 아이콘이 있고 실제 크기가 맞다', () => {
    const icons = manifest.icons as { src: string; sizes: string; purpose: string }[];
    for (const purpose of ['any', 'maskable']) {
      for (const size of [192, 512]) {
        const icon = icons.find((i) => i.purpose === purpose && i.sizes === `${size}x${size}`);
        expect(icon, `${purpose} ${size}`).toBeDefined();
        expect(pngSize(icon!.src)).toEqual([size, size]);
      }
    }
  });

  it('theme_color는 index.html meta theme-color와 같다', () => {
    const meta = html.match(/name="theme-color" content="([^"]+)"/)?.[1];
    expect(meta?.toLowerCase()).toBe(manifest.theme_color.toLowerCase());
  });
});

describe('index.html', () => {
  it('manifest 연결, 아이폰 전체 화면·이름·상태 표시줄, 안전 영역', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="반반"');
    expect(html).toMatch(/name="apple-mobile-web-app-status-bar-style" content="\w/);
    expect(html).toContain('viewport-fit=cover');
  });

  it('파비콘: SVG + ICO 대체', () => {
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="alternate icon" href="/favicon.ico" />');
  });

  it('apple-touch-icon 180px', () => {
    const href = html.match(/rel="apple-touch-icon" href="([^"]+)"/)?.[1];
    expect(href).toBeDefined();
    expect(pngSize(href!)).toEqual([180, 180]);
  });
});
