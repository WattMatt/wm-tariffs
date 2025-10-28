# Fabric.js + React Integration Pattern

## Overview

This document explains the architectural pattern used in `SchematicEditor.tsx` for integrating Fabric.js with React, specifically addressing the **stale closure problem** that occurs when canvas event handlers need to access current React state.

## The Problem: Stale Closures

### What Are Stale Closures?

When Fabric.js canvas event handlers are registered (e.g., `canvas.on('mouse:down', handler)`), they capture the **current values** of all variables referenced inside them. If React state changes after registration, the handlers still reference the **old values**, causing bugs.

### Example of the Problem

```typescript
// ❌ WRONG - This will NOT work correctly
const [activeTool, setActiveTool] = useState("select");

useEffect(() => {
  const canvas = new FabricCanvas(canvasRef.current);
  
  canvas.on('mouse:down', (opt) => {
    // BUG: activeTool is captured at registration time
    // If user changes tool, this handler still sees "select"
    if (activeTool === "draw") {
      // This won't execute even when user switches to draw mode
      startDrawing();
    }
  });
}, []); // Only runs once, handler never updates

// When user clicks button, state changes but handler doesn't know
<Button onClick={() => setActiveTool("draw")}>Switch to Draw</Button>
```

### Why This Happens

1. Event handler is registered once when component mounts
2. Handler creates a **closure** over `activeTool` variable
3. Closure captures `activeTool = "select"` 
4. User clicks button → `activeTool` state changes to `"draw"`
5. Handler still sees `"select"` because closure captured old value
6. Canvas interactions behave incorrectly

## The Solution: State + Ref Pattern

### Core Concept

Use **two parallel systems**:
- **STATE** for UI rendering and React lifecycle (triggers re-renders)
- **REF** for Fabric.js event handler access (always current, no re-renders)

### Implementation Pattern

#### Step 1: Create Both State and Ref

```typescript
const [activeTool, setActiveTool] = useState<"select" | "draw">("select");
const activeToolRef = useRef<"select" | "draw">("select");
```

#### Step 2: Sync Ref with State

```typescript
useEffect(() => {
  // Whenever state changes, update the ref
  activeToolRef.current = activeTool;
}, [activeTool]);
```

#### Step 3: Use Ref in Fabric.js Event Handlers

```typescript
useEffect(() => {
  const canvas = new FabricCanvas(canvasRef.current);
  
  canvas.on('mouse:down', (opt) => {
    // ✅ CORRECT - Always reads current value
    const currentTool = activeToolRef.current;
    
    if (currentTool === "draw") {
      startDrawing(); // Works correctly!
    }
  });
}, []);
```

#### Step 4: Update State in React Event Handlers

```typescript
// React button handlers update state normally
<Button onClick={() => setActiveTool("draw")}>
  Switch to Draw
</Button>
```

### Why This Works

1. **Refs are mutable**: Updating `ref.current` doesn't trigger re-renders
2. **Refs persist**: Same ref object exists across all renders
3. **Event handlers see latest**: When handlers read `ref.current`, they get the newest value
4. **State drives UI**: React components re-render based on state, not refs
5. **No re-registration needed**: Event handlers don't need to be recreated

## Examples from SchematicEditor

### Example 1: Tool Selection

```typescript
// State + Ref declaration
const [activeTool, setActiveTool] = useState<"select" | "meter" | "draw">("select");
const activeToolRef = useRef<"select" | "meter" | "draw">("select");

// Sync ref with state
useEffect(() => {
  activeToolRef.current = activeTool;
  // ... other tool-related setup
}, [activeTool]);

// Use ref in canvas handler
canvas.on('mouse:down', (opt) => {
  const currentTool = activeToolRef.current; // Not activeTool!
  
  if (currentTool === 'draw') {
    // Handle draw mode
  }
});
```

### Example 2: Repositioning Mode

```typescript
// Complex state object + ref
const [repositioningMeter, setRepositioningMeter] = useState<{\
  meterId?: string;
  meterIndex?: number;
  isSaved: boolean;
} | null>(null);

const repositioningMeterRef = useRef<typeof repositioningMeter>(null);

// Sync ref
useEffect(() => {
  repositioningMeterRef.current = repositioningMeter;
}, [repositioningMeter]);

// Check mode in canvas handler
canvas.on('mouse:down', (opt) => {
  // ✅ Correctly detects when repositioning is active
  if (repositioningMeterRef.current) {
    const pointer = canvas.getPointer(opt.e);
    // ... handle repositioning
  }
});

// Button activates repositioning
<Button onClick={() => {
  setRepositioningMeter({ meterId: '123', isSaved: true });
  // Handler immediately sees this via ref
}}>
  Reposition Meter
</Button>
```

## When to Use This Pattern

### ✅ Use Refs When:

- State determines canvas interaction behavior (tool modes, edit states)
- State changes frequently during user interaction
- Event handlers need to react to state changes without re-registration
- You encounter bugs where handlers use outdated values
- State controls conditional logic in mouse/keyboard handlers

### ❌ Don't Use Refs For:

- UI-only state that Fabric.js never accesses (loading spinners, dialog visibility)
- Derived values that can be computed from other state
- Simple callbacks that don't depend on changing state
- Data that only flows from canvas TO React (can use state setters directly)

## Common Pitfalls to Avoid

### Pitfall 1: Forgetting the Sync Effect

```typescript
// ❌ WRONG - Ref never updates
const [tool, setTool] = useState("select");
const toolRef = useRef("select");
// Missing: useEffect to sync ref with state!

canvas.on('mouse:down', () => {
  console.log(toolRef.current); // Always "select"
});
```

**Fix:** Always add the sync `useEffect`:
```typescript
useEffect(() => {
  toolRef.current = tool;
}, [tool]);
```

### Pitfall 2: Reading State Instead of Ref

```typescript
// ❌ WRONG - Reading state in handler
canvas.on('mouse:down', () => {
  if (activeTool === "draw") { // Stale value!
    startDrawing();
  }
});
```

**Fix:** Read from ref:
```typescript
canvas.on('mouse:down', () => {
  if (activeToolRef.current === "draw") { // Current value!
    startDrawing();
  }
});
```

### Pitfall 3: Using Refs for UI Rendering

```typescript
// ❌ WRONG - Component won't re-render
const toolRef = useRef("select");

return (
  <div>Current tool: {toolRef.current}</div>
  // Won't update when ref changes!
);
```

**Fix:** Use state for UI:
```typescript
const [activeTool, setActiveTool] = useState("select");

return (
  <div>Current tool: {activeTool}</div>
  // Re-renders when state changes!
);
```

## Advanced: Multiple Related Refs

For complex features like repositioning, you may need multiple refs:

```typescript
// All related to repositioning feature
const [repositioningMeter, setRepositioningMeter] = useState(null);
const [repositionStartPoint, setRepositionStartPoint] = useState(null);
const [isRepositionDragging, setIsRepositionDragging] = useState(false);

// Parallel refs
const repositioningMeterRef = useRef(null);
const repositionStartPointRef = useRef(null);
const isRepositionDraggingRef = useRef(false);

// Single sync effect for all related state
useEffect(() => {
  repositioningMeterRef.current = repositioningMeter;
  repositionStartPointRef.current = repositionStartPoint;
  isRepositionDraggingRef.current = isRepositionDragging;
}, [repositioningMeter, repositionStartPoint, isRepositionDragging]);
```

## Debugging Tips

### Check Ref vs State Values

Add logging to compare values:

```typescript
canvas.on('mouse:down', () => {
  console.log('State:', activeTool);
  console.log('Ref:', activeToolRef.current);
  // If these differ, you have a stale closure bug
});
```

### Verify Sync Effect Runs

```typescript
useEffect(() => {
  console.log('Syncing ref to:', activeTool);
  activeToolRef.current = activeTool;
}, [activeTool]);
```

### Test State Changes

```typescript
<Button onClick={() => {
  console.log('Before:', activeToolRef.current);
  setActiveTool("draw");
  // Ref updates in next tick after useEffect runs
  setTimeout(() => {
    console.log('After:', activeToolRef.current);
  }, 0);
}}>
```

## Performance Considerations

### Advantages
- ✅ No event handler re-registration (expensive with Fabric.js)
- ✅ No unnecessary canvas re-initialization
- ✅ Minimal re-renders (refs don't trigger them)
- ✅ Handlers execute faster (no closure creation overhead)

### Trade-offs
- Need to maintain dual state + ref system
- Slightly more complex code structure
- Must remember to sync refs with state

## Alternative Approaches (Not Recommended)

### Alternative 1: Re-register Handlers on State Change

```typescript
// ❌ Inefficient and error-prone
useEffect(() => {
  canvas.off('mouse:down'); // Remove old handler
  canvas.on('mouse:down', () => {
    // Now has current state, but...
    if (activeTool === 'draw') {
      startDrawing();
    }
  });
}, [activeTool]); // Re-run on every state change
```

**Problems:**
- Performance: Re-registering handlers is expensive
- Bugs: Easy to forget to remove old handlers (memory leaks)
- Complexity: Managing handler lifecycle manually
- Fabric.js quirks: Off/on doesn't always work as expected

### Alternative 2: Functional State Updates

```typescript
// ❌ Doesn't work with Fabric.js event handlers
canvas.on('mouse:down', () => {
  setActiveTool(currentTool => {
    // Can't use currentTool here for logic
    // because handler already executed
    if (currentTool === 'draw') {
      // Too late - mouse event already happened
    }
  });
});
```

**Problems:**
- Logic must run DURING event, not AFTER state update
- Can't make decisions based on state in handler
- Event handling happens synchronously

## Conclusion

The State + Ref pattern is the most reliable way to integrate Fabric.js with React:

1. **State** manages React's declarative UI
2. **Refs** provide imperative access for canvas handlers
3. **useEffect** keeps them synchronized
4. **Result** is predictable, performant, maintainable code

When you see this pattern in the code:
- ✅ It's intentional, not redundant
- ✅ Both state and ref serve distinct purposes
- ✅ Removing either one will cause bugs

## Further Reading

- [React Refs Documentation](https://react.dev/reference/react/useRef)
- [Fabric.js Events Documentation](http://fabricjs.com/events)
- [JavaScript Closures (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures)
