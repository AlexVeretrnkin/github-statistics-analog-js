import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { Main } from './main';

describe('Main', () => {
  let component: Main;
  let fixture: ComponentFixture<Main>;
  let httpTestingController: HttpTestingController;

  beforeEach(async () => {
    globalThis.IntersectionObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as never;

    await TestBed.configureTestingModule({
      imports: [Main],
      providers: [
        provideRouter([]),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    })
    .compileComponents();

    httpTestingController = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Main);

    httpTestingController.expectOne('/api/v1/labels?owner=facebook&repo=react').flush({
      repository: {
        id: 'repo-react',
        name: 'react',
        owner: 'facebook',
      },
      totalCount: 0,
      labels: [],
    });
    httpTestingController.expectOne('/api/v1/analysis/repositories').flush([]);
    httpTestingController
      .expectOne(
        (request) =>
          request.url === '/api/v1/issues' &&
          request.params.get('owner') === 'facebook' &&
          request.params.get('repo') === 'react',
      )
      .flush({
        from: '2025-06',
        to: '2026-05',
        repository: {
          id: 'repo-react',
          name: 'react',
          owner: 'facebook',
        },
        labels: [],
        months: [],
      });

    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
