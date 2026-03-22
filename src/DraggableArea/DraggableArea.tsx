import React, { useEffect, useRef, useState } from 'react';
import styles from './DraggableArea.module.scss';

/** Query for the draggable root used to measure panel size (Pixi init / resize). */
export const DRAGGABLE_LAYOUT_MEASURE_SELECTOR = '[data-layout-measure]';

export interface DraggableAreaProps {
  children: React.ReactNode;
  /** CSS transform scale applied with pan (e.g. canvas zoom). */
  scale?: number;
  /** When this increments, pan resets to origin (and typically parent resets scale). */
  layoutResetToken?: number;
  className?: string;
}

export const DraggableArea: React.FC<DraggableAreaProps> = ({
  children,
  scale = 1,
  layoutResetToken = 0,
  className,
}) => {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const panRef = useRef(pan);

  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    console.log('[DraggableArea] reset pan/drag', { scale, layoutResetToken });
    dragRef.current = null;
    queueMicrotask(() => {
      setPan({ x: 0, y: 0 });
      setDragging(false);
    });
  }, [scale, layoutResetToken]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: panRef.current.x,
      startPanY: panRef.current.y,
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    setPan({
      x: d.startPanX + (e.clientX - d.startClientX),
      y: d.startPanY + (e.clientY - d.startClientY),
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const rootClass = [
    styles.root,
    styles.pannable,
    dragging ? styles.dragging : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={rootClass}
      data-layout-measure=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => {
        dragRef.current = null;
        setDragging(false);
      }}
    >
      <div
        className={styles.transformWrap}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {children}
      </div>
    </div>
  );
};
