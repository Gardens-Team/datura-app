// Script to replace all Inter font family references with the new naming convention
const fs = require('fs');
const path = require('path');

// Function to recursively find all .tsx and .ts files
function findFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory() && !filePath.includes('node_modules')) {
      fileList = findFiles(filePath, fileList);
    } else if (
      stat.isFile() && 
      (filePath.endsWith('.tsx') || filePath.endsWith('.ts') || filePath.endsWith('.js'))
    ) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

// Find and replace font references in a file
function updateFontReferences(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    // Replace all occurrences of fontFamily: 'Inter'
    if (content.includes("fontFamily: 'Inter'") || content.includes('fontFamily: "Inter"')) {
      content = content
        .replace(/fontFamily:\s*['"]Inter['"]/g, "fontFamily: 'Inter_400Regular'");
      modified = true;
    }
    
    // Replace all occurrences of fontFamily: 'Inter-Medium'
    if (content.includes("fontFamily: 'Inter-Medium'") || content.includes('fontFamily: "Inter-Medium"')) {
      content = content
        .replace(/fontFamily:\s*['"]Inter-Medium['"]/g, "fontFamily: 'Inter_500Medium'");
      modified = true;
    }
    
    // Replace all occurrences of fontFamily: 'Inter-Bold'
    if (content.includes("fontFamily: 'Inter-Bold'") || content.includes('fontFamily: "Inter-Bold"')) {
      content = content
        .replace(/fontFamily:\s*['"]Inter-Bold['"]/g, "fontFamily: 'Inter_700Bold'");
      modified = true;
    }
    
    // Save the file if it was modified
    if (modified) {
      fs.writeFileSync(filePath, content);
      console.log(`Updated font references in: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
}

// Start from the project root directory
const rootDir = process.cwd();
const files = findFiles(rootDir);

// Process each file
files.forEach(updateFontReferences);

console.log(`Processed ${files.length} files`); 