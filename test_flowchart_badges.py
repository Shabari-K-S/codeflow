"""
Flowchart Badge Verification Script
Uses Playwright to capture the flowchart state after visualization.
"""
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1920, 'height': 1080})
    
    # Navigate to app
    page.goto('http://localhost:5174/app')
    page.wait_for_load_state('networkidle')
    
    # Wait for Monaco editor to be ready
    page.wait_for_selector('.monaco-editor', timeout=10000)
    time.sleep(1)  # Extra buffer for editor initialization
    
    # Set test code via Monaco API
    test_code = """function fibonacci(n) {
  if (n <= 1) {
    return n;
  }
  return fibonacci(n - 1) + fibonacci(n - 2);
}

let result = fibonacci(5);
console.log("Result:", result);"""
    
    page.evaluate(f"""() => {{
        const editors = window.monaco?.editor?.getEditors();
        if (editors && editors.length > 0) {{
            editors[0].setValue(`{test_code}`);
        }}
    }}""")
    
    time.sleep(0.5)
    
    # Click Visualize button
    visualize_btn = page.locator('button:has-text("Visualize")')
    visualize_btn.click()
    
    # Wait for flowchart to render
    page.wait_for_timeout(1500)
    
    # Capture screenshot
    screenshot_path = '/home/shabari/.gemini/antigravity/brain/d813ef82-4c1d-4971-a912-dd477c8fb35e/flowchart_badge_verification.png'
    page.screenshot(path=screenshot_path, full_page=False)
    
    print(f"Screenshot saved to: {screenshot_path}")
    
    browser.close()
