// App entry: the Expo Router app plus the home-screen widget's background handler.
import 'expo-router/entry';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './src/widget/task';
// Defines the background check for new applications (must load before the app starts)
import './src/lib/leader-alerts';

registerWidgetTaskHandler(widgetTaskHandler);
