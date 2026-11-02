import {
  createElement,
  forwardRef,
  Fragment,
  type ReactNode,
} from 'react';

// happy-dom's partial Web Animations API rejects when Framer Motion cancels
// animations during React teardown. Component tests verify semantics and
// interaction, not animation timelines, so render the same DOM without motion.
const motionOnlyProps = new Set([
  'initial', 'animate', 'exit', 'transition', 'variants',
  'whileHover', 'whileTap', 'whileFocus', 'whileInView',
  'viewport', 'layout', 'layoutId', 'drag', 'dragConstraints',
  'dragElastic', 'dragMomentum', 'onAnimationStart',
  'onAnimationComplete', 'onUpdate', 'onDrag', 'onDragStart', 'onDragEnd',
]);

export const motion = new Proxy<Record<string, unknown>>({}, {
  get: (_target, element: string) => forwardRef<HTMLElement, Record<string, unknown>>(
    (props, ref) => {
      const domProps = Object.fromEntries(
        Object.entries(props).filter(([key]) => !motionOnlyProps.has(key)),
      );
      const children = domProps.children as ReactNode;
      delete domProps.children;
      return createElement(element, { ...domProps, ref }, children);
    },
  ),
});

export function AnimatePresence({ children }: { children: ReactNode }) {
  return createElement(Fragment, null, children);
}
