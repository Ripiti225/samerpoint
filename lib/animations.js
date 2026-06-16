import { useSharedValue, useAnimatedStyle, withSpring, withTiming, withSequence, withDelay } from 'react-native-reanimated'

export const SPRINGS = {
  snappy:  { damping: 16, stiffness: 340, mass: 0.7 },
  gentle:  { damping: 24, stiffness: 180, mass: 0.9 },
  bouncy:  { damping: 9,  stiffness: 240, mass: 0.6 },
  elastic: { damping: 8,  stiffness: 200, mass: 0.5 },
}

// Press scale — wraps un Animated.View autour d'un élément cliquable
export function usePressScale(toScale = 0.95, spring = SPRINGS.snappy) {
  const scale = useSharedValue(1)
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))
  return {
    animatedStyle,
    onPressIn:  () => { scale.value = withSpring(toScale, spring) },
    onPressOut: () => { scale.value = withSpring(1, spring) },
  }
}

// Shake horizontal — pour les erreurs PIN
export function useShake() {
  const x = useSharedValue(0)
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }))
  const shake = () => {
    x.value = withSequence(
      withTiming(-12, { duration: 50 }),
      withTiming( 12, { duration: 55 }),
      withTiming(-10, { duration: 50 }),
      withTiming( 10, { duration: 50 }),
      withTiming( -6, { duration: 45 }),
      withTiming(  0, { duration: 45 }),
    )
  }
  return { animatedStyle, shake }
}

// Pulse opacity — pour les badges/notifications
export function usePulse(minOpacity = 0.4) {
  const opacity = useSharedValue(1)
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))
  const pulse = () => {
    opacity.value = withSequence(
      withTiming(minOpacity, { duration: 400 }),
      withTiming(1, { duration: 400 }),
      withTiming(minOpacity, { duration: 400 }),
      withTiming(1, { duration: 300 }),
    )
  }
  return { animatedStyle, pulse }
}

// Délai d'entrée staggerée pour les cartes de grille
export function staggerDelay(index, baseDelay = 60) {
  return index * baseDelay
}
