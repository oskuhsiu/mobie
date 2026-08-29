export function supportsWebGl(documentRef: Document = document): boolean {
  try {
    const view = documentRef.defaultView
    if (
      !view
      || (!('WebGLRenderingContext' in view) && !('WebGL2RenderingContext' in view))
    ) return false
    const canvas = documentRef.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    return Boolean(
      canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true })
      || canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true }),
    )
  } catch {
    return false
  }
}
