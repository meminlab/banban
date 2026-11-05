import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('앱 뼈대', () => {
  it('하단 탭 3개가 순서대로 보인다', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: '주요 메뉴' });
    const labels = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);
    expect(labels).toEqual(['홈', '가계부', '자산']);
  });

  it('탭을 누르면 화면이 바뀌고 현재 탭이 표시된다', async () => {
    const user = userEvent.setup();
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '가계부' }));
    expect(screen.getByRole('heading', { level: 1, name: '가계부' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '가계부' })).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('link', { name: '자산' }));
    expect(screen.getByRole('heading', { level: 1, name: '자산' })).toBeInTheDocument();
  });

  it('오른쪽 위 설정 버튼으로 설정 화면에 가고, 뒤로 버튼으로 돌아온다', async () => {
    const user = userEvent.setup();
    renderAt('/assets');
    await user.click(screen.getByRole('link', { name: '설정' }));
    expect(screen.getByRole('heading', { level: 1, name: '설정' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '뒤로' }));
    expect(screen.getByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
  });

  it('없는 주소는 홈으로 보낸다', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { level: 1, name: '홈' })).toBeInTheDocument();
  });
});
