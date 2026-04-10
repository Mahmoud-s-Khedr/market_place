import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'ts', 'json'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      lines: 70,
      functions: 70,
      branches: 60,
    },
  },
  testEnvironment: 'node',
};

export default config;
