# Contributing to parcelo 🎉

Thank you for considering contributing to parcelo! We welcome contributions from everyone.

## 📋 Code of Conduct

Be respectful, inclusive, and constructive. We're all here to build something great together.

## 🐛 Found a Bug?

1. **Check existing issues** to see if it's already reported
2. If not, **create a new issue** using the Bug Report template
3. Provide as much detail as possible (version, code sample, error logs)

## 💡 Have a Feature Idea?

1. **Check existing issues** to see if it's already suggested
2. If not, **create a new issue** using the Feature Request template
3. Explain the use case and why it would be valuable

## 🔧 Want to Contribute Code?

### Getting Started

1. **Fork the repository**
2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR-USERNAME/parcelo.git
   cd parcelo
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

### Development Workflow

1. **Make your changes**
   - Write clean, readable code
   - Follow existing code style
   - Add comments for complex logic

2. **Add tests**
   - Write tests for new features
   - Ensure existing tests still pass
   ```bash
   npm test
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Test your changes**
   ```bash
   # Run all tests
   npm test

   # Run examples
   npm run example:inmemory
   npm run example:distributed
   ```

### Code Style

- Use **TypeScript** with strict mode
- Follow existing patterns in the codebase
- Use **meaningful variable names**
- Write **JSDoc comments** for public APIs
- No `any` types - maintain type safety
- Format code consistently (we use standard TypeScript formatting)

### Commit Guidelines

Use clear, descriptive commit messages:

```bash
# Features
feat: add support for custom range types

# Bug fixes
fix: resolve memory leak in pending queue

# Documentation
docs: update README with new examples

# Tests
test: add integration tests for distributed mode

# Chores
chore: update dependencies
```

### Pull Request Process

1. **Update documentation** if needed
2. **Add tests** for new features
3. **Ensure all tests pass**
4. **Update CHANGELOG** (if applicable)
5. **Create a PR** with a clear description:
   - What does this PR do?
   - Why is this change needed?
   - How has it been tested?
   - Any breaking changes?

## 📝 Documentation

Help us improve documentation:

- Fix typos or unclear explanations
- Add examples
- Improve API documentation
- Write tutorials or guides

## 🧪 Testing

We value thorough testing:

- **Unit tests** for core functionality
- **Integration tests** for schedulers
- **Load tests** for performance
- **Edge cases** and error handling

Run tests:
```bash
npm test                    # All tests
npm run test:watch          # Watch mode
npm run test:comprehensive  # Distributed tests
npm run test:load          # Load tests
```

## 📦 Project Structure

```
parcelo/
├── src/
│   ├── core/           # Core scheduling logic
│   ├── store/          # Storage adapters
│   ├── worker/         # Worker pool
│   ├── adapters/       # Range type adapters
│   ├── utils/          # Utilities
│   └── types.ts        # Type definitions
├── tests/              # Test files
├── examples/           # Usage examples
└── dist/              # Compiled output
```

## 🤔 Questions?

- **Documentation**: Check the [README](README.md)
- **Issues**: Search [existing issues](https://github.com/harshmange44/parcelo/issues)
- **Discussions**: Start a [discussion](https://github.com/harshmange44/parcelo/discussions)
- **Direct contact**: Open an issue with the Question template

## 🎉 Recognition

All contributors will be recognized in our release notes and README.

Thank you for helping make parcelo better! 🚀

