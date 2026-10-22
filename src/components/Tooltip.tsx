import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

type Handlers = {
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLElement>) => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

type Props = {
  /** Nothing is shown without a text. */
  text: string | null | undefined;
  /** The element the tip is about. It must take focus to be reachable by keyboard. */
  children: ReactElement<Handlers>;
  /** Keeps the tip off, for example while the label it repeats is visible. */
  disabled?: boolean;
};

/** Hovering waits a little, so moving the mouse across a grid does not flash tips. */
const HOVER_DELAY = 450;
const GAP = 6;
const MARGIN = 8;

/** One tip at a time: a new one, by hover or focus, hides the one shown. */
let shown: { hide: () => void } | null = null;

/**
 * A tip shown on hover and on keyboard focus, in place of a `title`
 * attribute, which keyboards never show. Escape hides it. The text is also
 * the element's description for screen readers, unless it is already its
 * label.
 */
export function Tooltip({ text, children, disabled }: Props) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const timer = useRef<number>(undefined);
  const tip = useRef<HTMLDivElement>(null);
  const self = useRef({ hide: () => {} });

  const hide = () => {
    window.clearTimeout(timer.current);
    setAnchor(null);
    if (shown === self.current) shown = null;
  };
  self.current.hide = hide;

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (shown === self.current) shown = null;
    },
    [],
  );

  // Scrolling moves the element away from the tip.
  useEffect(() => {
    if (!anchor) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [anchor]);

  // Below the element, or above when there is no room, and inside the window.
  useLayoutEffect(() => {
    if (!anchor || !tip.current) return;
    const target = anchor.getBoundingClientRect();
    const own = tip.current.getBoundingClientRect();
    const below = target.bottom + GAP;
    const top = below + own.height + MARGIN > window.innerHeight ? target.top - GAP - own.height : below;
    const centered = target.left + target.width / 2 - own.width / 2;
    const left = Math.min(Math.max(centered, MARGIN), window.innerWidth - own.width - MARGIN);
    setStyle({ top: Math.max(top, MARGIN), left });
  }, [anchor, text]);

  if (!text || disabled) return children;

  const props = children.props;
  const described = text === props["aria-label"] ? undefined : id;
  const show = (element: HTMLElement) => {
    if (shown !== self.current) shown?.hide();
    shown = self.current;
    setStyle({ visibility: "hidden" });
    setAnchor(element);
  };

  return (
    <>
      {cloneElement(children, {
        "aria-describedby": [props["aria-describedby"], described].filter(Boolean).join(" ") || undefined,
        onMouseEnter: (event) => {
          props.onMouseEnter?.(event);
          const element = event.currentTarget;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => show(element), HOVER_DELAY);
        },
        onMouseLeave: (event) => {
          props.onMouseLeave?.(event);
          // A tip shown for keyboard focus stays until focus moves on.
          if (!event.currentTarget.matches(":focus-visible")) hide();
        },
        onFocus: (event) => {
          props.onFocus?.(event);
          // Only keyboard focus: a click already shows where the pointer is.
          if (event.currentTarget.matches(":focus-visible")) show(event.currentTarget);
        },
        onBlur: (event) => {
          props.onBlur?.(event);
          hide();
        },
        onMouseDown: (event) => {
          props.onMouseDown?.(event);
          hide();
        },
        onKeyDown: (event) => {
          if (event.key === "Escape" && anchor) {
            // Escape closes the tip first, and the drawer or dialog on the next press.
            event.preventDefault();
            event.stopPropagation();
            hide();
            return;
          }
          props.onKeyDown?.(event);
        },
      })}
      {described && (
        <span id={id} hidden>
          {text}
        </span>
      )}
      {anchor &&
        createPortal(
          <div ref={tip} className="tooltip" role="tooltip" aria-hidden="true" style={style}>
            {text}
          </div>,
          // A modal dialog sits above the page, so a tip in one goes inside it.
          anchor.closest("dialog") ?? document.body,
        )}
    </>
  );
}
