import { isKakaoInAppBrowser, kakaoOpenExternalUrl } from './inAppBrowser';

const UA = {
  kakaoAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36;KAKAOTALK 2410940',
  kakaoIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.0',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  safariIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  samsungInternet:
    'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  naverInApp:
    'Mozilla/5.0 (Linux; Android 14; SM-S921N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.10.0)',
};

describe('isKakaoInAppBrowser', () => {
  it.each([
    ['갤럭시 카카오톡', UA.kakaoAndroid],
    ['아이폰 카카오톡', UA.kakaoIos],
    ['소문자 표기', 'mozilla/5.0 kakaotalk 10.0'],
  ])('%s → 카카오 브라우저', (_name, ua) => {
    expect(isKakaoInAppBrowser(ua)).toBe(true);
  });

  it.each([
    ['안드로이드 크롬', UA.chromeAndroid],
    ['아이폰 사파리', UA.safariIos],
    ['삼성 인터넷', UA.samsungInternet],
    ['네이버 인앱 (이번 범위 밖)', UA.naverInApp],
    ['빈 값', ''],
    ['없음', undefined],
    ['null', null],
  ])('%s → 카카오 아님', (_name, ua) => {
    expect(isKakaoInAppBrowser(ua)).toBe(false);
  });
});

describe('kakaoOpenExternalUrl', () => {
  it('경로·쿼리·해시를 포함한 전체 주소를 인코딩해 넘긴다', () => {
    const url = 'https://banban-nzh.pages.dev/join/AB12CD?from=kakao&x=1#top';
    const out = kakaoOpenExternalUrl(url);
    expect(out.startsWith('kakaotalk://web/openExternal?url=')).toBe(true);
    const passed = new URL(out.replace('kakaotalk://', 'https://kakao.invalid/')).searchParams.get('url');
    expect(passed).toBe(url);
  });

  it('& 나 # 가 스킴 주소를 깨뜨리지 않는다', () => {
    const out = kakaoOpenExternalUrl('https://a.example/p?a=1&b=2#h');
    expect(out).toBe('kakaotalk://web/openExternal?url=https%3A%2F%2Fa.example%2Fp%3Fa%3D1%26b%3D2%23h');
  });
});
