// App entry: the Expo Router app plus the home-screen widget's background handler.
import 'expo-router/entry';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './src/widget/task';

registerWidgetTaskHandler(widgetTaskHandler);
