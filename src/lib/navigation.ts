/**
 * Scroll to and highlight a section element by ID
 * Fails silently if section is not found
 */
export function scrollToSection(sectionId: string) {
  try {
    const element = document.getElementById(sectionId);
    if (!element) {
      return;
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Add temporary highlight
    element.style.outline = '2px solid hsl(var(--primary))';
    element.style.backgroundColor = 'hsl(var(--primary) / 0.1)';
    element.style.transition = 'outline 0.3s ease, background-color 0.3s ease';

    setTimeout(() => {
      element.style.outline = '';
      element.style.backgroundColor = '';
      setTimeout(() => {
        element.style.transition = '';
      }, 300);
    }, 2000);
  } catch (error) {
    // Fail silently as per requirements
  }
}
