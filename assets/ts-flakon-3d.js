// Load the renderer only when the section approaches the viewport.
class FlakonViewer extends HTMLElement {
  connectedCallback() {
    this.generation = (this.generation || 0) + 1;
    const generation = this.generation;
    this.observer = new IntersectionObserver(async entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      this.observer.disconnect();
      try {
        const { createFlakonScene } = await import(this.dataset.module);
        if (!this.isConnected || this.generation !== generation) return;
        const scene = await createFlakonScene(this);
        if (!this.isConnected || this.generation !== generation) scene.dispose();
        else this.scene = scene;
      } catch (error) {
        console.error('Flakon 3D:', error);
        if (this.isConnected) this.querySelector('[role="status"]').textContent = 'Die 3D-Ansicht ist momentan nicht verfügbar.';
      }
    }, { rootMargin: '250px' });
    this.observer.observe(this);
  }
  disconnectedCallback() {
    this.generation++;
    this.observer?.disconnect();
    this.scene?.dispose();
    this.scene = null;
  }
}
if (!customElements.get('ts-flakon-viewer')) customElements.define('ts-flakon-viewer', FlakonViewer);
