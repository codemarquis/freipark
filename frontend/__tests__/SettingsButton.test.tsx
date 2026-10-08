import { fireEvent, render, screen } from '@testing-library/react-native';
import '../src/i18n';
import { SettingsButton } from '../src/features/settings/SettingsButton';

describe('SettingsButton', () => {
  it('is an accessible "Settings" button showing a text gear', async () => {
    await render(<SettingsButton onPress={jest.fn()} />);
    const button = screen.getByRole('button', { name: 'Settings' });
    expect(button).toBeTruthy();
    // U+2699 GEAR + U+FE0E text-variation selector: a plain symbol, not a colour emoji.
    expect(screen.getByText('⚙︎')).toBeTruthy();
  });

  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    await render(<SettingsButton onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
