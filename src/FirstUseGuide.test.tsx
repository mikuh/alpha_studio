import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIRST_USE_GUIDE_STORAGE_KEY, FirstUseGuide, OPEN_FIRST_USE_GUIDE_EVENT } from './FirstUseGuide';

describe('FirstUseGuide', () => {
  beforeEach(() => localStorage.clear());

  it('shows once, records completion, and can be reopened from settings', () => {
    render(<FirstUseGuide><div>workspace</div></FirstUseGuide>);
    expect(screen.getByRole('dialog', { name: '数据默认留在本机' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    fireEvent.click(screen.getByRole('button', { name: /开始使用/ }));
    expect(localStorage.getItem(FIRST_USE_GUIDE_STORAGE_KEY)).toBeTruthy();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent(window, new Event(OPEN_FIRST_USE_GUIDE_EVENT));
    expect(screen.getByRole('dialog', { name: '数据默认留在本机' })).toBeInTheDocument();
  });
});
