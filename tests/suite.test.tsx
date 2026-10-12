import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { renderRouter, screen as routerScreen } from 'expo-router/testing-library';
import * as Device from 'expo-device';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

jest.mock('expo-device', () => ({ modelName: 'MockPhone' }));

function Counter() {
  const [n, setN] = useState(0);
  return (
    <Pressable onPress={() => setN((x) => x + 1)} accessibilityRole="button">
      <Text>count {n}</Text>
    </Pressable>
  );
}

function Delayed() {
  const [msg, setMsg] = useState('waiting');
  useEffect(() => {
    const t = setTimeout(() => setMsg('done'), 1000);
    return () => clearTimeout(t);
  }, []);
  return <Text>{msg}</Text>;
}

function Fetcher() {
  const [v, setV] = useState('…');
  useEffect(() => {
    fetch('https://example.test/api').then((r) => r.json()).then((j) => setV(j.value));
  }, []);
  return <Text>value {v}</Text>;
}

function Anim() {
  const w = useSharedValue(10);
  const style = useAnimatedStyle(() => ({ width: w.value }));
  useEffect(() => {
    w.value = withTiming(100);
  }, [w]);
  return <Animated.View testID="anim" style={style} />;
}

describe('typical RN test patterns', () => {
  test('press events update state', async () => {
    await render(<Counter />);
    await fireEvent.press(screen.getByRole('button'));
    await fireEvent.press(screen.getByRole('button'));
    expect(screen.getByText('count 2')).toBeTruthy();
  });

  test('fake timers', async () => {
    jest.useFakeTimers();
    await render(<Delayed />);
    expect(screen.getByText('waiting')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText('done')).toBeTruthy();
    jest.useRealTimers();
  });

  test('mocked fetch + waitFor', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ json: async () => ({ value: 42 }) } as any);
    await render(<Fetcher />);
    await waitFor(() => expect(screen.getByText('value 42')).toBeTruthy());
    expect(spy).toHaveBeenCalledWith('https://example.test/api');
    spy.mockRestore();
  });

  test('jest.mock of an expo native module', () => {
    expect(Device.modelName).toBe('MockPhone');
  });

  test('reanimated mock renders', async () => {
    await render(<Anim />);
    expect(screen.getByTestId('anim')).toBeTruthy();
  });

  test('inline snapshot of a view tree', async () => {
    await render(
      <View testID="root">
        <Text>snap</Text>
      </View>
    );
    expect(screen.toJSON()).toMatchSnapshot();
  });

  test('expo-router renderRouter navigates', async () => {
    await renderRouter(
      {
        index: () => <Text>home</Text>,
        'details/[id]': () => <Text>details</Text>,
      },
      { initialUrl: '/details/7' }
    );
    expect(routerScreen.getByText('details')).toBeTruthy();
    expect(routerScreen.getByText('details')).toBeTruthy();
  });
});
