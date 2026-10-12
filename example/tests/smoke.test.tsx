import { render, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';

function Hello() {
  const v = useSharedValue(1);
  return (
    <View>
      <Text>Hello Bun {v.value}</Text>
      <Animated.View />
    </View>
  );
}

test('renders with reanimated mocked by jest-expo preset', async () => {
  await render(<Hello />);
  expect(screen.getByText('Hello Bun 1')).toBeTruthy();
  expect(screen.toJSON()).toMatchSnapshot();
});
