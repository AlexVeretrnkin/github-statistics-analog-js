import { ComponentFixture, TestBed } from '@angular/core/testing';

import SomeTestPage from './some-test.page';

describe('SomeTest', () => {
  let component: SomeTestPage;
  let fixture: ComponentFixture<SomeTestPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SomeTestPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SomeTestPage);
    fixture.componentRef.setInput('load', {});
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
